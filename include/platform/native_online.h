#ifndef PLATFORM_NATIVE_ONLINE_H
#define PLATFORM_NATIVE_ONLINE_H

#include <macros.h>
struct RectMenu;

// Online 2.0 feasibility API. Inactive during normal native/streaming play.
int NativeOnline_IsActive(void);
int NativeOnline_IsScheduled(void);
int NativeOnline_IsMenuFlow(void);
int NativeOnline_MenuMain(struct RectMenu *menu);
const char *NativeOnline_MenuString(int index);
int CTR_WebShellConfigure(void);
int CTR_WebShellStep(void);
void CTR_WebShellShutdown(void);
void CTR_WebLobbyOpen(void);
int CTR_WebLobbyAction(void);
int CTR_WebLobbyCode(void);
void CTR_WebLobbyKey(int key);
void CTR_WebLobbyStatus(int phase, int code, int slot, int readyBits);
void CTR_WebLobbyAvailable(int enabled);
int CTR_WebMenuInfo(int field);
int CTR_OnlineSetMenuFlow(int enabled);
int CTR_OnlineCanPredict(void);
int NativeOnline_ShouldPresent(void);
int NativeOnline_IsRollbackCapture(void);
int NativeOnline_LocalPlayer(void);
int CTR_OnlineSetLocalPlayer(int slot);
int CTR_OnlineViewInfo(int field);
void NativeOnline_MapAnchor(int *x, int *y);
void CTR_OnlineSetPresentation(int enabled);
const char *CTR_OnlineBuild(void);
int CTR_OnlineConfigure(int players, int track, unsigned int seed);
int CTR_OnlineSetPad(int slot, unsigned int buttons, int rx, int ry, int lx, int ly);
int CTR_OnlineStep(unsigned int tick);
int CTR_OnlineReady(void);
int CTR_OnlineTick(void);
int CTR_OnlineObserve(void *dst, int size);
int CTR_OnlineSave(void);
int CTR_OnlineRestore(void);
int CTR_OnlineSnapshotSize(void);
int CTR_OnlineSaveSlot(int slot);
int CTR_OnlineRestoreSlot(int slot, unsigned int expectedTick);
void CTR_OnlineShutdown(void);
u32 CTR_RunIteration(void);

#endif
