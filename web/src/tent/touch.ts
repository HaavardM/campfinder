// Is this a touch screen without a mouse (a phone or tablet)? Then there is
// no mouse to capture or keyboard to walk with: looking is a finger drag and
// walking an on-screen joystick.
export const touchOnly = window.matchMedia(
	"(hover: none) and (pointer: coarse)",
).matches;
