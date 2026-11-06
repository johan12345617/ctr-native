#ifndef CTR_UI_ONLINE_HUD_H
#define CTR_UI_ONLINE_HUD_H

// Presentation-only player count. Never use this for gameplay/player loops.
#ifdef CTR_NATIVE
#include <platform/native_online.h>
#define UI_FULL_SCREEN_ONLINE (NativeOnline_IsActive())
#else
#define UI_FULL_SCREEN_ONLINE 0
#endif
#define UI_PRESENTATION_PLAYERS(actual) (UI_FULL_SCREEN_ONLINE ? 1 : (actual))

#endif
