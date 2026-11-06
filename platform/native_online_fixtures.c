// Private test builds only. No network message can grant an item or run these
// fixtures; production binaries do not contain this API.
static int s_onlineFixture = -1;
static u32 s_onlineFixtureStart;
static struct Instance *s_onlineFixtureCrate;

ONLINE_EXPORT int CTR_OnlineTestSetup(int scenario, int juiced)
{
	if (scenario == 109 && s_onlineMenuFlow && CTR_OnlineReady() && s_onlineFixture == -1 && juiced == 0) {
		s_onlineFixture = scenario;
		return 1;
	}
	if (!CTR_OnlineReady() || s_onlineFixture != -1 || (juiced != 0 && juiced != 1) ||
	    !((scenario >= 0 && scenario <= 13) || (scenario >= 100 && scenario <= 108))) return 0;
	struct GameTracker *gt = sdata->gGT;
	if (gt->numPlyrCurrGame != 2 || gt->trafficLightsTimer >= 0 || (gt->gameMode1 & (START_OF_RACE | PAUSE_ALL))) return 0;
	for (int i = 0; i < 2; i++)
	{
		struct Driver *d = gt->drivers[i];
		d->heldItemID = scenario < 14 ? scenario : HELD_ITEM_NONE;
		d->numHeldItems = scenario < 14 ? ((scenario == 10 || scenario == 11) ? 3 : 1) : 0;
		d->numWumpas = juiced ? 10 : 0;
		d->noItemTimer = 0; d->itemRollTimer = 0;
		d->invincibleTimer = 0; d->invisibleTimer = 0; d->clockReceive = 0;
		d->pendingDamageType = 0;
	}
	if (scenario >= 101 && scenario <= 107)
	{
		static const int combinations[7][2] = {{1, 8}, {2, 6}, {3, 7}, {4, 0}, {1, 1}, {1, 6}, {1, 7}};
		for (int i = 0; i < 2; i++) { gt->drivers[i]->heldItemID = combinations[scenario - 101][i]; gt->drivers[i]->numHeldItems = 1; }
	}
	if (scenario == 100)
	{
		struct Model *model = NULL;
		for (u32 i = 0; i < gt->level1->numInstances; i++)
			if (gt->level1->ptrInstDefs[i].modelID == PU_RANDOM_CRATE) { model = gt->level1->ptrInstDefs[i].model; break; }
		if (!model) return 0;
		s_onlineFixtureCrate = INSTANCE_Birth3D(model, "online-crate", NULL);
		if (!s_onlineFixtureCrate) return 0;
		s_onlineFixtureCrate->matrix = gt->drivers[0]->instSelf->matrix;
		s_onlineFixtureCrate->scale.x = s_onlineFixtureCrate->scale.y = s_onlineFixtureCrate->scale.z = 0x1000;
	}
	s_onlineFixture = scenario; s_onlineFixtureStart = s_onlineTick;
	return 1;
}

static void NativeOnline_TestBeforeStep(void)
{
	if (s_onlineFixture == 109) {
		// Transition fixture only: feed finished drivers / a final battle hit
		// into the original results, standings and next-round code. No menu,
		// score table or next track is selected by the fixture itself.
		struct GameTracker *gt = sdata->gGT;
		if (!CTR_OnlineCanPredict() || gt->framesInThisLEV < 300 || (gt->drivers[0]->actionsFlagSet & ACTION_RACE_FINISHED)) return;
		if (gt->gameMode1 & BATTLE_MODE) {
			if (gt->gameMode1 & LIFE_LIMIT) {
				gt->drivers[1]->BattleHUD.numLives = 1;
				RB_Player_KillPlayer(gt->drivers[0], gt->drivers[1]);
			} else if (gt->gameMode1 & POINT_LIMIT) {
				gt->battleSetup.pointsPerTeam[gt->drivers[0]->BattleHUD.teamID] = gt->battleSetup.killLimit - 1;
				RB_Player_KillPlayer(gt->drivers[0], gt->drivers[1]);
			} else gt->originalEventTime = 0;
		} else {
			for (int i = 0; i < s_onlinePlayers; i++) {
				struct Driver *d = gt->drivers[i];
				d->lapIndex = gt->numLaps; d->driverRank = i;
				d->timeElapsedInRace = 30000 + i * 1000;
				d->actionsFlagSet |= ACTION_RACE_FINISHED;
			}
		}
		return;
	}
	if (s_onlineFixture == 108)
	{
		// Render regression: keep the remote racer in front of camera 0 past
		// its final retail LOD cutoff, without replacing any render/cull code.
		struct PushBuffer *pb = &sdata->gGT->pushBuffer[0];
		struct Driver *d = sdata->gGT->drivers[1];
		struct Model *model = d->instSelf->model;
		int distance = (u16)model->headers[model->numHeaders - 1].maxDistanceLOD + 1024;
		if (distance > 0x7000) distance = 0x7000;
		d->posCurr.x = (pb->pos.x + ((pb->matrix_ViewProj.m[2][0] * distance) >> 12)) * 256;
		d->posCurr.y = (pb->pos.y + ((pb->matrix_ViewProj.m[2][1] * distance) >> 12)) * 256;
		d->posCurr.z = (pb->pos.z + ((pb->matrix_ViewProj.m[2][2] * distance) >> 12)) * 256;
		d->posPrev = d->posCurr;
		memset(&d->velocity, 0, sizeof(d->velocity));
	}
	// Controlled impact placement, followed by the original projectile collision
	// and explosion path. The input gate deliberately disagrees in prediction.
	if (s_onlineFixture >= 105 && s_onlineTick - s_onlineFixtureStart == 8)
	{
		for (int i = 0; i < 2; i++)
		{
			u16 held = (u16)~(s_onlinePads[i].buttons[0] | ((u16)s_onlinePads[i].buttons[1] << 8));
			struct Instance *bomb = sdata->gGT->drivers[i]->instBombThrow;
			if (!(held & RAW_BTN_CROSS) || !bomb || !bomb->thread || !bomb->thread->object) continue;
			struct Driver *target = sdata->gGT->drivers[1 - i];
			struct TrackerWeapon *weapon = bomb->thread->object;
			for (int axis = 0; axis < 3; axis++) bomb->matrix.t[axis] = target->instSelf->matrix.t[axis];
			memset(&weapon->vel, 0, sizeof(weapon->vel));
			weapon->flags |= 2;
		}
	}
	// A controlled same-tick collision invokes the original crate collision
	// function. Only one player can consume it; replay executes this callback
	// again from restored crate/RNG state without an external mutable event log.
	if (s_onlineFixture == 100 && s_onlineTick - s_onlineFixtureStart == 5)
	{
		for (int i = 0; i < 2; i++)
		{
			u16 held = (u16)~(s_onlinePads[i].buttons[0] | ((u16)s_onlinePads[i].buttons[1] << 8));
			if (!(held & RAW_BTN_CROSS)) continue;
			struct ScratchpadStruct collision;
			memset(&collision, 0, sizeof(collision));
			collision.Input1.modelID = DYNAMIC_PLAYER;
			RB_CrateWeapon_LInC(s_onlineFixtureCrate, sdata->gGT->drivers[i]->instSelf->thread, &collision);
		}
	}
}

ONLINE_EXPORT int CTR_OnlineTestRacerView(int viewer, int racer, int field)
{
	if (!CTR_OnlineReady() || viewer < 0 || viewer >= s_onlinePlayers || racer < 0 || racer >= s_onlinePlayers) return -1;
	const struct PushBuffer *pb = &sdata->gGT->pushBuffer[viewer];
	const struct Instance *inst = sdata->gGT->drivers[racer]->instSelf;
	const struct InstDrawPerPlayer *idpp = &inst->idpp[viewer];
	s64 depth = (s64)pb->matrix_ViewProj.m[2][0] * (inst->matrix.t[0] - pb->pos.x) +
	            (s64)pb->matrix_ViewProj.m[2][1] * (inst->matrix.t[1] - pb->pos.y) +
	            (s64)pb->matrix_ViewProj.m[2][2] * (inst->matrix.t[2] - pb->pos.z);
	switch (field)
	{
	case 0: return (idpp->instFlags & DRAW_SUCCESSFUL) != 0 && idpp->mh != NULL;
	case 1: return (int)(((depth >> 12) * (pb->rect.w >> 1)) / pb->distanceToScreen_PREV);
	case 2: return (u16)inst->model->headers[inst->model->numHeaders - 1].maxDistanceLOD;
	case 3: return (inst->flags & (PIXEL_LOD | PUSHBUFFER_EXISTS)) != 0;
	case 4: return idpp->lodIndex;
	default: return -1;
	}
}
