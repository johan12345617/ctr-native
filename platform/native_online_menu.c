// Included by native_online.c. Lobby presentation uses the original engine's
// font, input and primitive arena; networking stays in the browser coordinator.
enum { ONLINE_TEXT = 0x7000, ONLINE_RACE, ONLINE_CUP, ONLINE_BATTLE, ONLINE_LEAVE };
static struct MenuRow s_onlineRootRows[10];
static int s_lobbyOpen, s_lobbyPage, s_lobbyRow, s_lobbyCursor, s_lobbyAction;
static int s_lobbyAvailable, s_lobbyPhase, s_lobbySlot, s_lobbyReady;
static u32 s_lobbyHeld;
static char s_lobbyCode[7] = "000000";

const char *NativeOnline_MenuString(int index)
{
	switch (index) {
	case ONLINE_TEXT: return "ONLINE";
	case ONLINE_RACE: return "RACE";
	case ONLINE_CUP: return "CUP";
	case ONLINE_BATTLE: return "BATTLE";
	case ONLINE_LEAVE: return "LEAVE LOBBY";
	default: return NULL;
	}
}
ONLINE_EXPORT int CTR_WebShellConfigure(void)
{
	if (s_platformInitialized || s_onlineActive) return 0;
	s_shellActive = 1;
	return 1;
}
ONLINE_EXPORT int CTR_WebShellStep(void)
{
	if (!s_shellActive || !s_platformInitialized) return 0;
	Platform_PollInput();
	if (!CTR_RunIteration()) return 0;
	if (!s_shellBooted) {
		sdata->gGT->gameMode1 = MAIN_MENU;
		sdata->gGT->numPlyrNextGame = 1;
		MainRaceTrack_StartLoad(MAIN_MENU_LEVEL);
		s_shellBooted = 1;
	}
	return 1;
}
ONLINE_EXPORT void CTR_WebShellShutdown(void) { s_shellActive = 0; Platform_Shutdown(); }
ONLINE_EXPORT void CTR_WebLobbyAvailable(int enabled) { s_lobbyAvailable = enabled != 0; }
ONLINE_EXPORT void CTR_WebLobbyOpen(void)
{
	if (!s_platformInitialized || sdata->gGT->levelID != MAIN_MENU_LEVEL) return;
	s_lobbyOpen = 1; s_lobbyPage = 0; s_lobbyRow = 0;
	s_lobbyHeld = sdata->gGamepads->anyoneHeldCurr;
}
ONLINE_EXPORT int CTR_WebLobbyAction(void) { int action = s_lobbyAction; s_lobbyAction = 0; return action; }
ONLINE_EXPORT int CTR_WebLobbyCode(void) { return (int)strtoul(s_lobbyCode, NULL, 16); }
ONLINE_EXPORT void CTR_WebLobbyKey(int key)
{
	if (s_lobbyOpen && key == 27) {
		if (s_lobbyPhase >= 2) s_lobbyAction = 3;
		else if (s_lobbyPage) s_lobbyPage = 0;
		else {
			s_lobbyOpen = 0;
			MM_MENU_MAIN.state &= ~(ONLY_DRAW_TITLE | DISABLE_INPUT_ALLOW_FUNCPTRS);
		}
		return;
	}
	if (!s_lobbyOpen || s_lobbyPage != 1 || s_lobbyPhase >= 2) return;
	if (key == 8) { if (s_lobbyCursor) s_lobbyCursor--; s_lobbyCode[s_lobbyCursor] = '0'; return; }
	if (key >= 'a' && key <= 'f') key -= 'a' - 'A';
	if ((key >= '0' && key <= '9') || (key >= 'A' && key <= 'F')) {
		if (s_lobbyCursor >= 6) return;
		s_lobbyCode[s_lobbyCursor] = (char)key;
		s_lobbyCursor++;
	}
}
ONLINE_EXPORT void CTR_WebLobbyStatus(int phase, int code, int slot, int readyBits)
{
	s_lobbyPhase = phase; s_lobbySlot = slot; s_lobbyReady = readyBits;
	if (code >= 0) snprintf(s_lobbyCode, sizeof(s_lobbyCode), "%06X", code & 0xffffff);
	if (phase != 0) s_lobbyOpen = 1;
}
ONLINE_EXPORT int CTR_WebMenuInfo(int field)
{
	if (!s_platformInitialized) return -1;
	switch (field) {
	case 0: return sdata->mainGameState;
	case 1: return sdata->Loading.stage;
	case 2: return sdata->gGT->levelID;
	case 3: return s_lobbyOpen;
	case 4: return s_lobbyPage;
	case 5: return s_lobbyPhase;
	case 6: return CTR_WebLobbyCode();
	case 7: return MM_ACTIVE_MENU == &MM_MENU_CHARACTER_SELECT ? 1 : MM_ACTIVE_MENU == &MM_MENU_TRACK_SELECT ? 2 :
	               MM_ACTIVE_MENU == &MM_MENU_CUP_SELECT ? 3 : MM_ACTIVE_MENU == &MM_MENU_BATTLE_WEAPONS ? 4 : 0;
	case 8: return MM_MENU_MAIN.rowSelected;
	case 9: return sdata->gGT->gameMode2;
	case 10: return sdata->gGT->gameMode1;
	case 11: return sdata->gGT->cup.trackIndex;
	case 12: return MM_TITLE_MENU_STATE;
	case 13: return sdata->gGT->numPlyrNextGame;
	case 14: return s_onlineMenuFlow ? 3 : (MM_GAME_UNLOCKS[MEMCARD_BIT_WORD(GAME_UNLOCK_BIT_SCRAPBOOK)] & MEMCARD_BIT_MASK(GAME_UNLOCK_BIT_SCRAPBOOK)) ? 7 : 6;
	case 15: return s_lobbyReady;
	case 16: return MM_CHARACTER_SELECT_MENU_STATE;
	case 17: return GAME_CHARACTER_IDS[0];
	case 18: return GAME_CHARACTER_IDS[1];
	case 19: return MM_TRACK_TRANSITION_STATE;
	case 20: return MM_CUP_TRANSITION_STATE;
	case 21: return MM_BATTLE_TRANSITION_STATE;
	case 22: return sdata->activeSubMenu ? sdata->activeSubMenu->rowSelected : -1;
	case 23: return MM_MENU_MAIN.state;
	case 24: return sdata->gGT->numLaps;
	case 25: return sdata->ptrActiveMenu ? sdata->ptrActiveMenu->rowSelected : -1;
	case 26: return (sdata->gGT->gameMode1 & END_OF_RACE) != 0;
	case 27: return sdata->gGT->cup.points[0];
	case 28: return sdata->gGT->cup.points[1];
	case 29: return sdata->gGT->battleSetup.pointsPerTeam[0];
	case 30: return CTR_OnlineReady() && sdata->gGT->drivers[1] ? sdata->gGT->drivers[1]->BattleHUD.numLives : -1;
	case 31: return sdata->battleSetupRowHighlighted;
	case 32: return sdata->gGT->battleSetup.teamOfEachPlayer[0];
	case 33: return sdata->gGT->battleSetup.teamOfEachPlayer[1];
	default: return -1;
	}
}
static void NativeOnline_LobbyLine(const char *text, int y, int selected)
{
	DecalFont_DrawLine((char *)text, 0x100, y, FONT_SMALL, JUSTIFY_CENTER | (selected ? ORANGE : WHITE));
}
static void NativeOnline_LobbyDraw(void)
{
	u32 held = sdata->gGamepads->anyoneHeldCurr;
	u32 tap = held & ~s_lobbyHeld; s_lobbyHeld = held;
	NativeOnline_LobbyLine("ONLINE", 28, 1);
	if (s_lobbyPhase >= 2) {
		char line[64];
		snprintf(line, sizeof(line), "LOBBY CODE: %s", s_lobbyCode);
		NativeOnline_LobbyLine(line, 55, 1);
		if (s_lobbyPhase == 2 || s_lobbyPhase == 4) {
			NativeOnline_LobbyLine(s_lobbyPhase == 2 ? "CONNECTING..." : "LOADING GAME...", 83, 0);
		} else if (s_lobbyPhase == 5) {
			NativeOnline_LobbyLine("COULD NOT CONNECT. TRY AGAIN.", 83, 0);
		} else {
			NativeOnline_LobbyLine(s_lobbyReady & 1 ? "PLAYER 1: READY" : "PLAYER 1: LOADING", 80, 0);
			NativeOnline_LobbyLine(s_lobbyReady & 2 ? "PLAYER 2: READY" : "PLAYER 2: WAITING", 97, 0);
			if (s_lobbySlot == 0 && s_lobbyReady == 3) NativeOnline_LobbyLine("C / ENTER: START", 127, 1);
			else NativeOnline_LobbyLine("WAITING FOR THE OTHER PLAYER", 127, 0);
		}
		NativeOnline_LobbyLine("V: LEAVE / CANCEL", 163, 0);
		if (s_lobbyPhase == 3) NativeOnline_LobbyLine("SPACE / SELECT: COPY CODE", 183, 0);
		if (s_lobbyPhase == 3 && (tap & BTN_SELECT)) s_lobbyAction = 5;
		if (tap & (BTN_TRIANGLE | BTN_SQUARE_one)) s_lobbyAction = 3;
		if (s_lobbyPhase == 3 && s_lobbySlot == 0 && s_lobbyReady == 3 && (tap & (BTN_CROSS_one | BTN_START))) s_lobbyAction = 4;
		if (s_lobbyPhase == 5 && (tap & (BTN_CROSS_one | BTN_START))) { s_lobbyPhase = 0; s_lobbyPage = 0; s_lobbyCursor = 0; }
		return;
	}
	if (s_lobbyPage == 1) {
		NativeOnline_LobbyLine("ENTER LOBBY CODE", 60, 0);
		NativeOnline_LobbyLine(s_lobbyCode, 87, 1);
		char cursor[7] = "      "; cursor[s_lobbyCursor < 6 ? s_lobbyCursor : 5] = '^';
		NativeOnline_LobbyLine(cursor, 100, 1);
		NativeOnline_LobbyLine("TYPE CODE OR USE ARROWS TO EDIT", 127, 0);
		NativeOnline_LobbyLine("ENTER: JOIN    V: BACK", 150, 0);
		if (tap & BTN_LEFT) s_lobbyCursor = (s_lobbyCursor + 5) % 6;
		if (tap & BTN_RIGHT) s_lobbyCursor = s_lobbyCursor < 6 ? (s_lobbyCursor + 1) % 6 : 0;
		if (tap & (BTN_UP | BTN_DOWN)) {
			if (s_lobbyCursor >= 6) s_lobbyCursor = 5;
			const char *digits = "0123456789ABCDEF";
			int digit = (int)(strchr(digits, s_lobbyCode[s_lobbyCursor]) - digits);
			s_lobbyCode[s_lobbyCursor] = digits[(digit + (tap & BTN_UP ? 1 : 15)) % 16];
		}
		if (tap & (BTN_CROSS_one | BTN_START)) { s_lobbyPhase = 2; s_lobbyAction = 2; }
		if (tap & (BTN_TRIANGLE | BTN_SQUARE_one)) s_lobbyPage = 0;
		return;
	}
	if (tap & BTN_UP) s_lobbyRow = (s_lobbyRow + 2) % 3;
	if (tap & BTN_DOWN) s_lobbyRow = (s_lobbyRow + 1) % 3;
	NativeOnline_LobbyLine("CREATE LOBBY", 73, s_lobbyRow == 0);
	NativeOnline_LobbyLine("JOIN LOBBY", 98, s_lobbyRow == 1);
	NativeOnline_LobbyLine("BACK", 123, s_lobbyRow == 2);
	NativeOnline_LobbyLine(s_lobbyAvailable ? "C / ENTER: SELECT    V: BACK" : "ONLINE SERVER IS NOT ENABLED", 165, 0);
	if (tap & (BTN_TRIANGLE | BTN_SQUARE_one)) s_lobbyOpen = 0;
	if (tap & (BTN_CROSS_one | BTN_START)) {
		if (s_lobbyRow == 2) s_lobbyOpen = 0;
		else if (s_lobbyAvailable && s_lobbyRow == 0) { s_lobbyPhase = 2; s_lobbyAction = 1; }
		else if (s_lobbyAvailable) { s_lobbyPage = 1; s_lobbyCursor = 0; memcpy(s_lobbyCode, "000000", 7); }
	}
}
int NativeOnline_MenuMain(struct RectMenu *menu)
{
	if (!s_shellActive && !s_onlineMenuFlow) return 0;
	if (s_lobbyOpen && !s_onlineActive) {
		menu->state |= ONLY_DRAW_TITLE | DISABLE_INPUT_ALLOW_FUNCPTRS;
		NativeOnline_LobbyDraw();
		if (!s_lobbyOpen) menu->state &= ~(ONLY_DRAW_TITLE | DISABLE_INPUT_ALLOW_FUNCPTRS);
		return 1;
	}
	int count;
	if (s_onlineMenuFlow) {
		count = 4;
		for (int i = 0; i < count; i++) s_onlineRootRows[i].stringIndex = ONLINE_RACE + i;
	} else {
		struct MenuRow *original = (MM_GAME_UNLOCKS[MEMCARD_BIT_WORD(GAME_UNLOCK_BIT_SCRAPBOOK)] & MEMCARD_BIT_MASK(GAME_UNLOCK_BIT_SCRAPBOOK))
		    ? MM_ROWS_MAIN_WITH_SCRAPBOOK : D230.rowsMainMenuBasic;
		for (count = 0; original[count].stringIndex >= 0; count++) s_onlineRootRows[count] = original[count];
		s_onlineRootRows[count++].stringIndex = ONLINE_TEXT;
	}
	for (int i = 0; i < count; i++) {
		s_onlineRootRows[i].rowOnPressUp = i ? i - 1 : 0;
		s_onlineRootRows[i].rowOnPressDown = i + 1 < count ? i + 1 : i;
		s_onlineRootRows[i].rowOnPressLeft = s_onlineRootRows[i].rowOnPressRight = i;
	}
	s_onlineRootRows[count].stringIndex = RECTMENU_STRING_NONE;
	menu->rows = s_onlineRootRows;
	if (menu->rowSelected >= count) menu->rowSelected = 0;
	if (s_onlineMenuFlow) GAME_TRACKER->demoCountdownTimer = 1000000;
	if (menu->funcState != RECTMENU_FUNC_STATE_INPUT || menu->rowSelected < 0) return 0;
	int choice = menu->rows[menu->rowSelected].stringIndex;
	if (choice == ONLINE_TEXT) { CTR_WebLobbyOpen(); return 1; }
	if (choice == ONLINE_LEAVE) { s_lobbyAction = 3; return 1; }
	if (!s_onlineMenuFlow) return 0;
	GAME_TRACKER->gameMode1 &= ~(BATTLE_MODE | ADVENTURE_MODE | TIME_TRIAL | ADVENTURE_ARENA | ARCADE_MODE | ADVENTURE_CUP);
	GAME_TRACKER->gameMode2 &= ~CUP_ANY_KIND;
	if (choice == ONLINE_BATTLE) GAME_TRACKER->gameMode1 |= BATTLE_MODE;
	if (choice == ONLINE_CUP) GAME_TRACKER->gameMode2 |= CUP_ANY_KIND;
	GAME_TRACKER->numPlyrNextGame = s_onlinePlayers;
	GAME_TRACKER->numLaps = 3;
	MM_CHARACTER_SELECT_TRANSITION_STATE = EXITING_MENU;
	MM_TITLE_MENU_STATE = TITLE_MENU_STATE_EXITING;
	MM_DESIRED_MENU_INDEX = MM_EXIT_ROUTE_CHARACTER_SELECT;
	menu->state |= ONLY_DRAW_TITLE;
	return 1;
}
