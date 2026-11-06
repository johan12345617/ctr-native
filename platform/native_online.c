#include "platform/native_online.h"
#include "platform/native_checkpoint.h"
#include "platform/native_input.h"
#include "platform/native_gpu.h"

#if defined(__EMSCRIPTEN__)
#include <emscripten.h>
#define ONLINE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define ONLINE_EXPORT
#endif

static int s_onlineActive, s_onlinePlayers, s_onlineTrack, s_onlineBooted;
static int s_onlineMenuFlow, s_shellActive, s_shellBooted;
static u32 s_onlineSeed, s_onlineTick;
static struct PlatformInputPadSnapshot s_onlinePads[PLATFORM_INPUT_PAD_COUNT];
// Slot 0 retains the original feasibility API. Prediction uses a bounded ring
// of nine checkpoints: one confirmed state and at most eight predicted ticks.
#define NATIVE_ONLINE_CHECKPOINT_SLOTS 10
struct NativeOnlineCheckpoint
{
	void *bytes;
	int size;
	u64 counter, counterBase;
	int vblank, level;
	u32 tick;
};
static struct NativeOnlineCheckpoint s_onlineCheckpoints[NATIVE_ONLINE_CHECKPOINT_SLOTS];
static int s_onlinePresentation = 1;
static int s_onlineRollbackCapture;
// Presentation identity stays outside checkpoints and shared game state.
static int s_onlineLocalPlayer = -1;

int NativeOnline_IsActive(void) { return s_onlineActive; }
int NativeOnline_IsScheduled(void) { return s_onlineActive || s_shellActive; }
int NativeOnline_IsMenuFlow(void) { return s_onlineActive && s_onlineMenuFlow; }
int NativeOnline_ShouldPresent(void) { return !s_onlineActive || s_onlinePresentation; }
int NativeOnline_IsRollbackCapture(void) { return s_onlineActive && s_onlineRollbackCapture; }
int NativeOnline_LocalPlayer(void) {
	return s_onlineActive && (!s_platformInitialized || !(sdata->gGT->gameMode1 & MAIN_MENU)) ? s_onlineLocalPlayer : -1;
}
ONLINE_EXPORT int CTR_OnlineSetMenuFlow(int enabled)
{
	if (!s_onlineActive || s_onlineBooted) return 0;
	s_onlineMenuFlow = enabled != 0;
	return 1;
}
ONLINE_EXPORT int CTR_OnlineCanPredict(void)
{
	return CTR_OnlineReady() && sdata->gGT->levelID >= 0 && sdata->gGT->levelID < 25 &&
	       !(sdata->gGT->gameMode1 & (MAIN_MENU | END_OF_RACE | PAUSE_ALL | LOADING | GAME_CUTSCENE));
}
ONLINE_EXPORT int CTR_OnlineSetLocalPlayer(int slot)
{
	if (!s_onlineActive || s_onlineBooted || slot < 0 || slot >= s_onlinePlayers) return 0;
	s_onlineLocalPlayer = slot;
	return 1;
}
ONLINE_EXPORT int CTR_OnlineViewInfo(int field)
{
	if (!CTR_OnlineReady()) return -1;
	struct PushBuffer *pb = &sdata->gGT->pushBuffer[s_onlineLocalPlayer >= 0 ? s_onlineLocalPlayer : 0];
	switch (field)
	{
	case 0: return s_onlineLocalPlayer;
	case 1: return pb->rect.w;
	case 2: return pb->rect.h;
	case 3: return NativeGpu_OnlineViewMask();
	case 4: { int x, y; NativeOnline_MapAnchor(&x, &y); return x; }
	case 5: { int x, y; NativeOnline_MapAnchor(&x, &y); return y; }
	case 6: return sdata->gGT->ptrIcons[3] != NULL && sdata->gGT->ptrIcons[4] != NULL;
	default: return -1;
	}
}
void NativeOnline_MapAnchor(int *x, int *y)
{
	// Map art and all racer/projectile markers share this bottom-right anchor.
	// Leave the original position number below it and the clock above it.
	struct GameTracker *gt = sdata->gGT;
	int width = 0;
	for (int i = 3; i <= 4; i++) if (gt->ptrIcons[i])
	{
		int partWidth = gt->ptrIcons[i]->texLayout.u1 - gt->ptrIcons[i]->texLayout.u0;
		if (partWidth > width) width = partWidth;
	}
	*x = 20 + width; *y = 160;
}
ONLINE_EXPORT void CTR_OnlineSetPresentation(int enabled) { s_onlinePresentation = enabled != 0; }

ONLINE_EXPORT const char *CTR_OnlineBuild(void)
{
#if defined(CTR_ONLINE_SOURCE_ID)
#if defined(CTR_ONLINE_PROBES)
	return CTR_ONLINE_SOURCE_ID "/online-v2-4/probes";
#else
	return CTR_ONLINE_SOURCE_ID "/online-v2-4/runtime";
#endif
#elif defined(CTR_NATIVE_VERSION) && defined(CTR_NATIVE_BUILD_ID)
	return CTR_NATIVE_VERSION "/" CTR_NATIVE_BUILD_ID "/online-v2-4";
#else
	return "development/online-v2-4";
#endif
}

ONLINE_EXPORT int CTR_OnlineConfigure(int players, int track, unsigned int seed)
{
	// Deliberately reject eight humans until the layout audit is implemented.
	if (s_onlineActive || s_platformInitialized || players < 2 || players > PLATFORM_INPUT_PAD_COUNT || track < 0 || track >= 18) return 0;
	s_onlinePlayers = players; s_onlineTrack = track; s_onlineSeed = seed;
	s_onlineActive = 1;
	memset(s_onlinePads, 0, sizeof(s_onlinePads));
	for (int i = 0; i < PLATFORM_INPUT_PAD_COUNT; i++)
	{
		s_onlinePads[i].status = i < players ? 0 : 0xff;
		s_onlinePads[i].id = 0x73;
		s_onlinePads[i].buttons[0] = s_onlinePads[i].buttons[1] = 0xff;
		memset(s_onlinePads[i].analog, 128, 4);
		s_onlinePads[i].connected = i < players;
	}
	return 1;
}

ONLINE_EXPORT int CTR_OnlineSetPad(int slot, unsigned int buttons, int rx, int ry, int lx, int ly)
{
	if (!s_onlineActive || slot < 0 || slot >= s_onlinePlayers || buttons > 65535 ||
	    (unsigned)rx > 255 || (unsigned)ry > 255 || (unsigned)lx > 255 || (unsigned)ly > 255) return 0;
	struct PlatformInputPadSnapshot *pad = &s_onlinePads[slot];
	pad->buttons[0] = (u8)~buttons; pad->buttons[1] = (u8)~(buttons >> 8);
	pad->analog[0] = rx; pad->analog[1] = ry; pad->analog[2] = lx; pad->analog[3] = ly;
	return 1;
}

ONLINE_EXPORT int CTR_OnlineReady(void)
{
	return s_onlineActive && s_platformInitialized && s_onlineBooted && sdata->mainGameState == 3 &&
	       sdata->Loading.stage == LOAD_IDLE && (sdata->gGT->drivers[0] != NULL ||
	       (s_onlineMenuFlow && sdata->gGT->levelID == MAIN_MENU_LEVEL));
}

ONLINE_EXPORT int CTR_OnlineTick(void) { return (int)s_onlineTick; }

#if defined(CTR_ONLINE_PROBES)
#include "native_online_fixtures.c"
#endif

ONLINE_EXPORT int CTR_OnlineStep(unsigned int tick)
{
	if (!s_onlineActive || !s_platformInitialized || tick != s_onlineTick || tick >= 0x7fffffffu) return 0;
	struct PlatformInputPadSnapshot pads[PLATFORM_INPUT_PAD_COUNT];
	memcpy(pads, s_onlinePads, sizeof(pads));
	// Each player owns their character. Shared setup and results belong to the
	// host so an opponent cannot accidentally change the host's menu selection.
	if (s_onlineMenuFlow && sdata->mainGameState == 3 &&
	    ((sdata->gGT->gameMode1 & MAIN_MENU) || sdata->ptrActiveMenu) &&
	    !(sdata->gGT->levelID == MAIN_MENU_LEVEL && (MM_ACTIVE_MENU == &MM_MENU_CHARACTER_SELECT ||
	      (MM_ACTIVE_MENU == &MM_MENU_BATTLE_WEAPONS && sdata->battleSetupRowHighlighted == 2))))
		for (int i = 1; i < s_onlinePlayers; i++) {
			pads[i].buttons[0] = pads[i].buttons[1] = 0xff;
			memset(pads[i].analog, 128, sizeof(pads[i].analog));
		}
	Platform_InputInstallPadSnapshots(pads, PLATFORM_INPUT_PAD_COUNT);
	Platform_InputUpdate();
#if defined(CTR_ONLINE_PROBES)
	NativeOnline_TestBeforeStep();
#endif
	if (!CTR_RunIteration()) return 0;
	if (!s_onlineBooted)
	{
		struct GameTracker *gt = sdata->gGT;
		gt->gameMode1 = s_onlineMenuFlow ? MAIN_MENU : 0;
		gt->gameMode2 = 0;
		gt->numPlyrNextGame = s_onlineMenuFlow ? 1 : s_onlinePlayers;
		gt->numLaps = 3;
		for (int i = 0; i < s_onlinePlayers; i++) GAME_CHARACTER_IDS[i] = i;
		sdata->randomNumber = s_onlineSeed;
		sdata->audioRNG = s_onlineSeed ^ 0x9e3779b9u;
		PSX_BIOS_SetRandSeed(s_onlineSeed);
		MainRaceTrack_StartLoad(s_onlineMenuFlow ? MAIN_MENU_LEVEL : s_onlineTrack);
		s_onlineBooted = 1;
	}
	s_onlineTick++;
	return 1;
}

// Diagnostic observations, NOT a complete replication/restore format. Encode
// fields explicitly so host pointers, struct padding, and endianness never leak.
static void NativeOnline_WriteWord(u8 **dst, u32 word)
{
	for (int i = 0; i < 4; i++) *(*dst)++ = (u8)(word >> (i * 8));
}

#include "native_online_world.c"

ONLINE_EXPORT int CTR_OnlineObserve(void *dst, int size)
{
	const int required = (16 + 8 * 24 + NATIVE_ONLINE_WORLD_WORDS) * 4;
	if (!s_onlineActive || !s_platformInitialized || !dst || size < required) return 0;
	u8 *out = dst;
	struct GameTracker *gt = sdata->gGT;
#define ONLINE_WORD(value) NativeOnline_WriteWord(&out, (u32)(value))
	ONLINE_WORD(4); ONLINE_WORD(s_onlineTick); ONLINE_WORD(gt->levelID);
	ONLINE_WORD(sdata->mainGameState); ONLINE_WORD(sdata->Loading.stage);
	ONLINE_WORD(gt->gameMode1); ONLINE_WORD(gt->timer); ONLINE_WORD(gt->elapsedTimeMS);
	ONLINE_WORD(gt->msInThisLEV); ONLINE_WORD(gt->elapsedEventTime);
	ONLINE_WORD(sdata->randomNumber); ONLINE_WORD(sdata->audioRNG);
	ONLINE_WORD(PSX_BIOS_GetRandSeed()); ONLINE_WORD(gt->trafficLightsTimer);
	ONLINE_WORD(gt->numPlyrCurrGame); ONLINE_WORD(gt->clockEffectEnabled);
	for (int i = 0; i < 8; i++)
	{
		struct Driver *driver = CTR_OnlineReady() ? gt->drivers[i] : NULL;
		if (!driver) { memset(out, 0, 24 * 4); out += 24 * 4; continue; }
		ONLINE_WORD(1); ONLINE_WORD(driver->posCurr.x); ONLINE_WORD(driver->posCurr.y); ONLINE_WORD(driver->posCurr.z);
		ONLINE_WORD(driver->velocity.x); ONLINE_WORD(driver->velocity.y); ONLINE_WORD(driver->velocity.z);
		ONLINE_WORD(driver->speed); ONLINE_WORD(driver->reserves); ONLINE_WORD(driver->kartState);
		ONLINE_WORD(driver->actionsFlagSet); ONLINE_WORD(driver->collisionFlags);
		ONLINE_WORD(driver->numWumpas); ONLINE_WORD(driver->heldItemID); ONLINE_WORD(driver->numHeldItems);
		ONLINE_WORD(driver->lapIndex); ONLINE_WORD(driver->lapTime); ONLINE_WORD(driver->clockReceive);
		ONLINE_WORD(driver->clockSend); ONLINE_WORD(driver->invincibleTimer); ONLINE_WORD(driver->invisibleTimer);
		ONLINE_WORD(driver->itemRollTimer); ONLINE_WORD(driver->jumpMeter); ONLINE_WORD(driver->turbo_MeterRoomLeft);
	}
#undef ONLINE_WORD
	NativeOnline_ObserveWorld(&out);
	return required;
}

static int NativeOnline_SaveSlot(int slot)
{
	if (!CTR_OnlineReady() || slot < 0 || slot >= NATIVE_ONLINE_CHECKPOINT_SLOTS) return 0;
	struct NativeOnlineCheckpoint *checkpoint = &s_onlineCheckpoints[slot];
	int size = NativeCheckpoint_GetSize();
	if (size <= 0) return 0;
	if (size != checkpoint->size)
	{
		void *next = realloc(checkpoint->bytes, size);
		if (!next) return 0;
		checkpoint->bytes = next;
	}
	checkpoint->size = 0;
	if (!NativeCheckpoint_Capture(checkpoint->bytes, size)) return 0;
	checkpoint->size = size;
	checkpoint->counter = s_rootCounterValue;
	checkpoint->counterBase = s_rootCounterBase;
	checkpoint->vblank = s_nativeVBlankCount;
	checkpoint->tick = s_onlineTick;
	checkpoint->level = sdata->gGT->levelID;
	return size;
}

static int NativeOnline_RestoreSlot(int slot, unsigned int expectedTick)
{
	// A predicted menu/load request may have just suspended prediction. The
	// previous same-level checkpoint is still valid before loading is advanced.
	if (!s_platformInitialized || slot < 0 || slot >= NATIVE_ONLINE_CHECKPOINT_SLOTS) return 0;
	struct NativeOnlineCheckpoint *checkpoint = &s_onlineCheckpoints[slot];
	if (!checkpoint->size || checkpoint->tick != expectedTick || checkpoint->level != sdata->gGT->levelID ||
	    !NativeCheckpoint_Restore(checkpoint->bytes, checkpoint->size)) return 0;
	s_rootCounterValue = checkpoint->counter;
	s_rootCounterBase = checkpoint->counterBase;
	s_nativeVBlankCount = checkpoint->vblank;
	s_onlineTick = checkpoint->tick;
	return 1;
}

ONLINE_EXPORT int CTR_OnlineSaveSlot(int slot)
{
	s_onlineRollbackCapture = slot > 0;
	int result = NativeOnline_SaveSlot(slot);
	s_onlineRollbackCapture = 0;
	return result;
}
ONLINE_EXPORT int CTR_OnlineRestoreSlot(int slot, unsigned int expectedTick)
{
	s_onlineRollbackCapture = slot > 0;
	int result = NativeOnline_RestoreSlot(slot, expectedTick);
	s_onlineRollbackCapture = 0;
	return result;
}
ONLINE_EXPORT int CTR_OnlineSave(void) { return CTR_OnlineSaveSlot(0); }
ONLINE_EXPORT int CTR_OnlineRestore(void) { return CTR_OnlineRestoreSlot(0, s_onlineCheckpoints[0].tick); }
ONLINE_EXPORT int CTR_OnlineSnapshotSize(void) { return s_onlineCheckpoints[0].size; }
ONLINE_EXPORT void CTR_OnlineShutdown(void)
{
	for (int i = 0; i < NATIVE_ONLINE_CHECKPOINT_SLOTS; i++)
	{
		free(s_onlineCheckpoints[i].bytes);
		memset(&s_onlineCheckpoints[i], 0, sizeof(s_onlineCheckpoints[i]));
	}
	Platform_Shutdown();
}

#include "native_online_menu.c"
