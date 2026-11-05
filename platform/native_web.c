// Browser bridge. The host owns the simulation; future transports deliver
// controller state here while guests watch the host's canvas/audio stream.
#include <emscripten.h>
#include "platform/native_input.h"

EMSCRIPTEN_KEEPALIVE int CTR_WebSetPad(int slot, unsigned int buttons, int rightX, int rightY, int leftX, int leftY)
{
	return Platform_InputSetRemotePad(slot, buttons, rightX, rightY, leftX, leftY);
}

EMSCRIPTEN_KEEPALIVE int CTR_WebClearPad(int slot)
{
	return Platform_InputClearRemotePad(slot);
}

EMSCRIPTEN_KEEPALIVE int CTR_WebSetKeyboardPlayer(int slot)
{
	return Platform_InputSetKeyboardPlayer(slot);
}

EMSCRIPTEN_KEEPALIVE int CTR_WebGetKeyboardPlayer(void)
{
	return Platform_InputGetKeyboardPlayer();
}
