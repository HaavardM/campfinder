//! Reading terrain tiles and writing results as GeoTIFF.
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

use tiff::decoder::{Decoder, DecodingResult};
use tiff::encoder::{TiffEncoder, colortype};
use tiff::tags::Tag;

use crate::grid::Grid;

/// Reads a single-band float32 GeoTIFF (as downloaded from Kartverket's
/// terrain WCS) that must be `size` × `size` pixels. Georeferencing is not
/// read back: the tile name says where it is.
pub fn read_f32(path: &Path, size: usize) -> Result<Grid, String> {
    match decode(path, size)? {
        DecodingResult::F32(data) => Ok(Grid {
            width: size,
            height: size,
            data,
        }),
        _ => Err(format!("{}: expected 32-bit float pixels", path.display())),
    }
}

/// Reads a single-band 8-bit GeoTIFF (the water masks made by
/// `gdal_rasterize`) that must be `size` × `size` pixels.
pub fn read_u8(path: &Path, size: usize) -> Result<Vec<u8>, String> {
    match decode(path, size)? {
        DecodingResult::U8(data) => Ok(data),
        _ => Err(format!("{}: expected 8-bit pixels", path.display())),
    }
}

fn decode(path: &Path, size: usize) -> Result<DecodingResult, String> {
    let error = |e: &dyn std::fmt::Display| format!("{}: {e}", path.display());
    let file = File::open(path).map_err(|e| error(&e))?;
    let mut decoder = Decoder::new(BufReader::new(file)).map_err(|e| error(&e))?;
    let (width, height) = decoder.dimensions().map_err(|e| error(&e))?;
    if (width as usize, height as usize) != (size, size) {
        return Err(error(&format!(
            "expected {size}×{size} pixels, got {width}×{height}"
        )));
    }
    decoder.read_image().map_err(|e| error(&e))
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
    write(path, |encoder| {
        let mut image = encoder.new_image::<colortype::Gray32Float>(width as u32, height as u32)?;
        write_geo_tags(image.encoder(), at, "nan")?;
        image.write_data(data)
    })
}

pub fn write_i16(
    path: &Path,
    width: usize,
    height: usize,
    data: &[i16],
    at: &Georef,
) -> Result<(), String> {
    write(path, |encoder| {
        let mut image = encoder.new_image::<colortype::GrayI16>(width as u32, height as u32)?;
        write_geo_tags(image.encoder(), at, "-1")?;
        image.write_data(data)
    })
}

/// Like `write_atomic`, but streaming through the TIFF encoder.
fn write(
    path: &Path,
    encode: impl FnOnce(&mut TiffEncoder<BufWriter<File>>) -> tiff::TiffResult<()>,
) -> Result<(), String> {
    let tmp = path.with_extension("tif.tmp");
    let file = File::create(&tmp).map_err(|e| format!("{}: {e}", tmp.display()))?;
    let mut encoder = TiffEncoder::new(BufWriter::new(file)).map_err(|e| e.to_string())?;
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
}
