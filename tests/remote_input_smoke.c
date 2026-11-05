#define SDL_MAIN_HANDLED
#include <SDL3/SDL.h>
#include "platform/native_input.h"
#include <stdio.h>
#include <string.h>

int g_padCommEnable = 1;
#define CHECK(expr) do { if (!(expr)) { fprintf(stderr, "Failed at line %d: %s\n", __LINE__, #expr); return 1; } } while (0)

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
	Platform_InputShutdown();
	SDL_Quit();
	puts("Remote input validation, multitap, replay priority, release, and timeout passed.");
	return 0;
}
