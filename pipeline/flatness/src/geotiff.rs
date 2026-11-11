//! Reading elevation tiles and writing tiles and results as GeoTIFF.
//!
//! A GeoTIFF is a normal TIFF image plus a few tags that place it on Earth:
//!
//! - `ModelTiepointTag`: map coordinates of the top-left corner;
//! - `ModelPixelScaleTag`: pixel size in map units (metres here);
//! - `GeoKeyDirectoryTag`: which coordinate system those map units are in,
//!   here EPSG:25833 (ETRS89 / UTM zone 33N).
//!
//! That's all QGIS or GDAL needs to show the image in the right place.

use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

use tiff::decoder::{ChunkType, Decoder, DecodingResult};
use tiff::encoder::{Compression, DeflateLevel, TiffEncoder, colortype};
use tiff::tags::Tag;

use crate::grid::Grid;

/// Reads a single-band float32 GeoTIFF (an elevation tile from Kartverket)
/// that must be `size` × `size` pixels. Georeferencing is not
/// read back: the tile name says where it is.
///
/// A TIFF image is stored in pieces (tiles or strips), and Kartverket leaves
/// out the pieces it has no data for: sea in both models, and Sweden in the
/// surface model. Their byte count is 0, and those pixels become NaN, which
/// the processing treats as missing data. (Read as a whole, the tiff crate
/// fills such pieces with garbage, or fails if all are missing.)
pub fn read_f32(path: &Path, size: usize) -> Result<Grid, String> {
    let error = |e: &dyn std::fmt::Display| format!("{}: {e}", path.display());
    let mut decoder = open_f32(path, size)?;
    let byte_counts = match decoder.get_chunk_type() {
        ChunkType::Tile => decoder.get_tag_u64_vec(Tag::TileByteCounts),
        ChunkType::Strip => decoder.get_tag_u64_vec(Tag::StripByteCounts),
    }
    .map_err(|e| error(&e))?;

    // Every piece there (all our own files): read the image in one go.
    if byte_counts.iter().all(|&bytes| bytes > 0) {
        return match decoder.read_image().map_err(|e| error(&e))? {
            DecodingResult::F32(data) => Ok(Grid {
                width: size,
                height: size,
                data,
            }),
            _ => Err(error(&"expected 32-bit float pixels")),
        };
    }

    // Some pieces missing: start from all NaN and fill in the ones there.
    let mut grid = Grid::filled(size, size, f32::NAN);
    let (piece_width, piece_height) = decoder.chunk_dimensions();
    let pieces_across = size.div_ceil(piece_width as usize);
    for (index, &bytes) in byte_counts.iter().enumerate() {
        if bytes == 0 {
            continue; // no data here
        }
        let DecodingResult::F32(data) = decoder.read_chunk(index as u32).map_err(|e| error(&e))?
        else {
            return Err(error(&"expected 32-bit float pixels"));
        };
        // Pieces at the right and bottom edges can be smaller; `data` holds
        // just their own pixels, row by row.
        let width = decoder.chunk_data_dimensions(index as u32).0 as usize;
        let left = (index % pieces_across) * piece_width as usize;
        let top = (index / pieces_across) * piece_height as usize;
        for (row, values) in data.chunks(width).enumerate() {
            let start = (top + row) * size + left;
            grid.data[start..start + width].copy_from_slice(values);
        }
    }
    Ok(grid)
}

/// Is the elevation tile at `path` (as for `read_f32`) compressed? Reads
/// only its header.
pub fn is_compressed(path: &Path, size: usize) -> Result<bool, String> {
    let mut decoder = open_f32(path, size)?;
    // Compression method 1 means none.
    Ok(decoder.get_tag_u32(Tag::Compression).unwrap_or(1) != 1)
}

fn open_f32(path: &Path, size: usize) -> Result<Decoder<BufReader<File>>, String> {
    let error = |e: &dyn std::fmt::Display| format!("{}: {e}", path.display());
    let file = File::open(path).map_err(|e| error(&e))?;
    let mut decoder = Decoder::new(BufReader::new(file)).map_err(|e| error(&e))?;
    let (width, height) = decoder.dimensions().map_err(|e| error(&e))?;
    if (width as usize, height as usize) != (size, size) {
        return Err(error(&format!(
            "expected {size}×{size} pixels, got {width}×{height}"
        )));
    }
    if decoder.colortype().map_err(|e| error(&e))? != tiff::ColorType::Gray(32) {
        return Err(error(&"expected single-band 32-bit pixels"));
    }
    Ok(decoder)
}

/// Writes `bytes` to `<path>.tmp` and renames it into place, so an
/// interrupted run never leaves a half-written file that looks finished.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Where a raster sits: map coordinates (EPSG:25833) of its top-left corner,
/// and its pixel size in metres.
pub struct Georef {
    pub west: f64,
    pub north: f64,
    pub pixel_size: f64,
}

pub fn write_f32(
    path: &Path,
    width: usize,
    height: usize,
    data: &[f32],
    at: &Georef,
) -> Result<(), String> {
    write(path, Compression::Uncompressed, |encoder| {
        let mut image = encoder.new_image::<colortype::Gray32Float>(width as u32, height as u32)?;
        write_geo_tags(image.encoder(), at, "nan")?;
        image.write_data(data)
    })
}

/// Like `write_f32`, but compressed without loss: about 7.5 MB instead of
/// 16.8 for a downloaded elevation tile.
///
/// Heights in metres with all their decimals look like noise to a
/// compressor (deflate alone saves 25%). TIFF's floating-point predictor
/// (predictor 3, Adobe's TIFF Technical Note 3) rearranges each row first:
///
/// 1. Split every float into its 4 bytes, and store all the rows' first
///    (most significant) bytes, then all the second bytes, and so on.
///    Neighbouring heights share their sign, exponent and leading digits,
///    so the first two runs are nearly constant.
/// 2. Replace every byte by its difference from the one before, which turns
///    those near-constant runs into runs of zeros: easy to compress.
///
/// The tiff crate reads this predictor but can't write it, so the rows are
/// rearranged here and the tag set by hand. GDAL and QGIS read it as usual.
pub fn write_f32_compressed(path: &Path, grid: &Grid, at: &Georef) -> Result<(), String> {
    let mut rows = Vec::with_capacity(grid.data.len());
    for row in grid.data.chunks(grid.width) {
        rows.extend(float_predictor(row));
    }
    write(path, Compression::Deflate(DeflateLevel::Balanced), |encoder| {
        let mut image =
            encoder.new_image::<colortype::Gray32Float>(grid.width as u32, grid.height as u32)?;
        write_geo_tags(image.encoder(), at, "nan")?;
        image.encoder().write_tag(Tag::Predictor, 3u16)?; // floating point
        image.write_data(&rows)
    })
}

/// One row through the floating-point predictor (see `write_f32_compressed`).
/// The result is bytes, handed back as floats only because the encoder
/// wants floats for a float image; it writes their bytes unchanged.
fn float_predictor(row: &[f32]) -> Vec<f32> {
    let n = row.len();
    let mut bytes = vec![0u8; 4 * n];
    for (i, value) in row.iter().enumerate() {
        for (plane, byte) in value.to_be_bytes().into_iter().enumerate() {
            bytes[plane * n + i] = byte;
        }
    }
    // Backwards, so each byte is subtracted from its original neighbour.
    for i in (1..bytes.len()).rev() {
        bytes[i] = bytes[i].wrapping_sub(bytes[i - 1]);
    }
    bytes
        .chunks_exact(4)
        .map(|b| f32::from_ne_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

pub fn write_i16(
    path: &Path,
    width: usize,
    height: usize,
    data: &[i16],
    at: &Georef,
) -> Result<(), String> {
    write(path, Compression::Uncompressed, |encoder| {
        let mut image = encoder.new_image::<colortype::GrayI16>(width as u32, height as u32)?;
        write_geo_tags(image.encoder(), at, "-1")?;
        image.write_data(data)
    })
}

/// Like `write_atomic`, but streaming through the TIFF encoder.
fn write(
    path: &Path,
    compression: Compression,
    encode: impl FnOnce(&mut TiffEncoder<BufWriter<File>>) -> tiff::TiffResult<()>,
) -> Result<(), String> {
    let tmp = path.with_extension("tif.tmp");
    let file = File::create(&tmp).map_err(|e| format!("{}: {e}", tmp.display()))?;
    let mut encoder = TiffEncoder::new(BufWriter::new(file))
        .map_err(|e| e.to_string())?
        .with_compression(compression);
    encode(&mut encoder).map_err(|e| format!("{}: {e}", path.display()))?;
    drop(encoder);
    std::fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

fn write_geo_tags<W: std::io::Write + std::io::Seek, K: tiff::encoder::TiffKind>(
    encoder: &mut tiff::encoder::DirectoryEncoder<'_, W, K>,
    at: &Georef,
    nodata: &str,
) -> tiff::TiffResult<()> {
    // Pixel (0, 0) ↔ map point (west, north). Six numbers: raster x, y, z,
    // then map x, y, z.
    encoder.write_tag(
        Tag::ModelTiepointTag,
        &[0.0, 0.0, 0.0, at.west, at.north, 0.0][..],
    )?;
    encoder.write_tag(
        Tag::ModelPixelScaleTag,
        &[at.pixel_size, at.pixel_size, 0.0][..],
    )?;
    // GeoKeys come in groups of four numbers: key id, where the value is
    // stored (0 = inline), count, value. The first group is a header:
    // version 1.1.0 with 3 keys.
    let geo_keys: [u16; 16] = [
        1, 1, 0, 3, //
        1024, 0, 1, 1, // GTModelTypeGeoKey = projected coordinate system
        1025, 0, 1, 1, // GTRasterTypeGeoKey = pixels are areas, not points
        3072, 0, 1, 25833, // ProjectedCSTypeGeoKey = EPSG:25833
    ];
    encoder.write_tag(Tag::GeoKeyDirectoryTag, &geo_keys[..])?;
    // Which value means "no data" (a GDAL convention that QGIS understands).
    encoder.write_tag(Tag::GdalNodata, nodata)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_read_round_trips() {
        let dir = std::env::temp_dir().join(format!("flatness-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.tif");
        let data: Vec<f32> = (0..16).map(|v| v as f32 * 1.5).collect();
        let at = Georef {
            west: 220000.0,
            north: 6866000.0,
            pixel_size: 10.0,
        };
        write_f32(&path, 4, 4, &data, &at).unwrap();
        let grid = read_f32(&path, 4).unwrap();
        assert_eq!(grid.data, data);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_pieces_read_as_nan() {
        // Kartverket's real reply for a surface tile in Sweden: 2016 × 2016
        // pixels in 128 × 128 pieces, and not one of them stored.
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata/no-data.tif");
        let grid = read_f32(&path, 2016).unwrap();
        assert!(grid.data.iter().all(|v| v.is_nan()));
    }

    #[test]
    fn compressed_round_trips_exactly() {
        let dir = std::env::temp_dir().join(format!("flatness-test-c-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.tif");
        // Heights with all their decimals, over several rows, plus a NaN
        // and a negative value.
        let mut data: Vec<f32> = (0..64)
            .map(|v| 1000.0 + (v as f32 * 0.731).sin() * 3.17)
            .collect();
        data[10] = f32::NAN;
        data[20] = -2.5;
        let grid = Grid {
            width: 8,
            height: 8,
            data,
        };
        let at = Georef {
            west: 0.0,
            north: 0.0,
            pixel_size: 1.0,
        };
        write_f32_compressed(&path, &grid, &at).unwrap();
        let back = read_f32(&path, 8).unwrap().data;
        let bits = |v: &[f32]| v.iter().map(|x| x.to_bits()).collect::<Vec<_>>();
        assert_eq!(bits(&back), bits(&grid.data));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
