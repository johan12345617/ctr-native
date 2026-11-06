#define SDL_MAIN_HANDLED
#include <SDL3/SDL.h>
#include "platform/native_input.h"
#include <stdio.h>
#include <string.h>

int g_padCommEnable = 1;
#define CHECK(expr) do { if (!(expr)) { fprintf(stderr, "Failed at line %d: %s\n", __LINE__, #expr); return 1; } } while (0)

static int test_gamepad(Uint16 vendor, Uint16 product, const char *name)
{
	SDL_VirtualJoystickDesc desc;
	SDL_INIT_INTERFACE(&desc);
	desc.type = SDL_JOYSTICK_TYPE_GAMEPAD;
	desc.vendor_id = vendor; desc.product_id = product; desc.name = name;
	desc.naxes = SDL_GAMEPAD_AXIS_COUNT; desc.nbuttons = SDL_GAMEPAD_BUTTON_COUNT;
	desc.button_mask = (1u << SDL_GAMEPAD_BUTTON_COUNT) - 1;
	desc.axis_mask = (1u << SDL_GAMEPAD_AXIS_COUNT) - 1;
	SDL_JoystickID id = SDL_AttachVirtualJoystick(&desc);
	CHECK(id != 0);
	SDL_Joystick *joystick = SDL_OpenJoystick(id);
	CHECK(joystick != NULL);
	Platform_InputControllerAdded(id);
	Platform_InputControllerAdded(id); // Startup enumeration plus a queued hot-plug event.
	CHECK(SDL_SetJoystickVirtualAxis(joystick, SDL_GAMEPAD_AXIS_LEFT_TRIGGER, -32768));
	CHECK(SDL_SetJoystickVirtualAxis(joystick, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER, -32768));
	SDL_UpdateGamepads();
	CHECK(SDL_SetJoystickVirtualAxis(joystick, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER, 32767));
	CHECK(SDL_SetJoystickVirtualAxis(joystick, SDL_GAMEPAD_AXIS_LEFTX, -32768));
	CHECK(SDL_SetJoystickVirtualButton(joystick, SDL_GAMEPAD_BUTTON_SOUTH, true));
	CHECK(SDL_SetJoystickVirtualButton(joystick, SDL_GAMEPAD_BUTTON_LEFT_SHOULDER, true));
	SDL_UpdateGamepads();
	Platform_InputUpdate();
	struct PlatformInputPadSnapshot pads[4];
	CHECK(Platform_InputCapturePadSnapshots(pads, 4) == 4);
	CHECK(pads[0].connected && pads[0].id == 0x73);
	if ((u16)~(pads[0].buttons[0] | pads[0].buttons[1] << 8) != 0x4600)
		fprintf(stderr, "%s: buttons=%04x, axes=%u/%u/%u/%u\n", name,
		        (u16)~(pads[0].buttons[0] | pads[0].buttons[1] << 8), pads[0].analog[0], pads[0].analog[1], pads[0].analog[2], pads[0].analog[3]);
	CHECK((u16)~(pads[0].buttons[0] | pads[0].buttons[1] << 8) == 0x4600);
	CHECK(pads[0].analog[2] == 0);
	for (int slot = 1; slot < 4; slot++) CHECK(pads[slot].buttons[0] == 0xff && pads[slot].buttons[1] == 0xff);
	CHECK(Platform_InputGetKeyboardPlayer() == 1);
	Platform_InputControllerRemoved(id);
	SDL_CloseJoystick(joystick);
	CHECK(SDL_DetachVirtualJoystick(id));
	Platform_InputUpdate();
	CHECK(Platform_InputCapturePadSnapshots(pads, 4) == 4);
	for (int slot = 0; slot < 4; slot++) CHECK(pads[slot].buttons[0] == 0xff && pads[slot].buttons[1] == 0xff);
	CHECK(Platform_InputSetKeyboardPlayer(0));
	return 0;
}

int main(void)
{
	struct PlatformInputPadSnapshot local[4], pads[4], replay[4];
	unsigned char bus[34] = {0}, secondPort[34] = {0};
	CHECK(SDL_Init(0));
	CHECK(Platform_InputInit());
	Platform_InputPadInit(0, bus);
	Platform_InputPadInit(1, secondPort);
	Platform_InputUpdate();
	CHECK(Platform_InputCapturePadSnapshots(local, 4) == 4);

	CHECK(!Platform_InputSetRemotePad(-1, 0, 128, 128, 128, 128));
	CHECK(!Platform_InputSetRemotePad(4, 0, 128, 128, 128, 128));
	CHECK(!Platform_InputSetRemotePad(2, 0x10000, 128, 128, 128, 128));
	CHECK(!Platform_InputSetRemotePad(2, 0, -1, 128, 128, 128));
	CHECK(!Platform_InputSetRemotePad(2, 0, 128, 128, 256, 128));
	CHECK(!Platform_InputClearRemotePad(4));
	CHECK(!Platform_InputSetKeyboardPlayer(-1));
	CHECK(Platform_InputSetKeyboardPlayer(3));
	CHECK(Platform_InputGetKeyboardPlayer() == 3);
	CHECK(Platform_InputSetKeyboardPlayer(0));

	CHECK(Platform_InputSetRemotePad(2, 0x4020, 1, 255, 30, 200));
	Platform_InputUpdate();
	CHECK(Platform_InputCapturePadSnapshots(pads, 4) == 4);
	CHECK(pads[2].connected && pads[2].id == 0x73);
	CHECK(pads[2].buttons[0] == 0xdf && pads[2].buttons[1] == 0xbf);
	CHECK(pads[2].analog[0] == 1 && pads[2].analog[1] == 255 && pads[2].analog[2] == 30 && pads[2].analog[3] == 200);
	CHECK(memcmp(&pads[0], &local[0], sizeof(pads[0])) == 0);
	CHECK(bus[1] == 0x80 && bus[2 + 2 * 8 + 1] == 0x73);

	memcpy(replay, local, sizeof(replay));
	CHECK(Platform_InputInstallPadSnapshots(replay, 4) == 4);
	Platform_InputUpdate();
	CHECK(Platform_InputCapturePadSnapshots(pads, 4) == 4);
	CHECK(memcmp(pads, replay, sizeof(pads)) == 0);
	Platform_InputClearInstalledPadSnapshots();
	Platform_InputUpdate();
	CHECK(Platform_InputCapturePadSnapshots(pads, 4) == 4 && pads[2].connected);

	CHECK(Platform_InputClearRemotePad(2));
	Platform_InputUpdate();
	CHECK(Platform_InputCapturePadSnapshots(pads, 4) == 4);
	CHECK(memcmp(&pads[2], &local[2], sizeof(pads[2])) == 0);

	CHECK(Platform_InputSetRemotePad(2, 0x4000, 128, 128, 128, 128));
	SDL_Delay(1050);
	Platform_InputUpdate();
	CHECK(Platform_InputCapturePadSnapshots(pads, 4) == 4);
	CHECK(memcmp(&pads[2], &local[2], sizeof(pads[2])) == 0);
	CHECK(test_gamepad(0x045e, 0x028e, "Xbox XInput test controller") == 0);
	CHECK(test_gamepad(0x054c, 0x05c4, "DualShock 4 test controller") == 0);
	CHECK(test_gamepad(0x054c, 0x0ce6, "DualSense test controller") == 0);
	Platform_InputShutdown();
	SDL_Quit();
	puts("Remote input validation, multitap, replay priority, release, and timeout passed.");
	return 0;
}
