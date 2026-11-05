#ifndef PLATFORM_NATIVE_INPUT_H
#define PLATFORM_NATIVE_INPUT_H

#include <macros.h>

#define PLATFORM_INPUT_PAD_COUNT 4

struct PlatformInputPadSnapshot
{
	u8 status;
	u8 id;
	u8 buttons[2];
	u8 analog[4];
	u8 connected;
	u8 reserved[3];
};

int Platform_InputInit(void);
void Platform_InputShutdown(void);
void Platform_InputUpdate(void);
void Platform_InputControllerAdded(int deviceIndex);
void Platform_InputControllerRemoved(int instanceId);
int Platform_InputCycleKeyboardController(void);
int Platform_InputCycleGamepadController(void);
// Remote pads override only their assigned slot; all other pads stay local.
// Buttons use a pressed-bit PSX mask; axes are bytes centered at 128.
int Platform_InputSetRemotePad(int slot, unsigned int buttons, int rightX, int rightY, int leftX, int leftY);
int Platform_InputClearRemotePad(int slot);
int Platform_InputSetKeyboardPlayer(int slot);
int Platform_InputGetKeyboardPlayer(void);

void Platform_InputPadInit(int slot, unsigned char *padData);
int Platform_InputPadGetState(int port);
void Platform_InputPadVibrate(int port, unsigned char *table, int len);
int Platform_InputCapturePadSnapshots(struct PlatformInputPadSnapshot *dst, int count);
int Platform_InputInstallPadSnapshots(const struct PlatformInputPadSnapshot *src, int count);
void Platform_InputClearInstalledPadSnapshots(void);
int Platform_InputGetStateSize(void);
int Platform_InputCaptureState(void *dst, int dstSize);
int Platform_InputRestoreState(const void *src, int srcSize);

#endif
