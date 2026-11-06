// Included by native_online.c. Explicit semantic observations never hash host
// addresses, GPU resources, or uninitialized structure padding.
#define NATIVE_ONLINE_WORLD_WORDS 256
static u32 NativeOnline_HashWord(u32 hash, u32 value)
{
	for (int i = 0; i < 4; i++) { hash ^= (u8)(value >> (i * 8)); hash *= 16777619u; }
	return hash;
}
static int NativeOnline_DriverID(const struct Driver *driver)
{
	if (!driver) return -1;
	for (int i = 0; i < 8; i++) if (sdata->gGT->drivers[i] == driver) return i;
	return -1;
}
static u32 NativeOnline_HashVec(u32 hash, const SVec3 *v)
{
	hash = NativeOnline_HashWord(hash, v->x);
	hash = NativeOnline_HashWord(hash, v->y);
	return NativeOnline_HashWord(hash, v->z);
}
static u32 NativeOnline_HashInstance(u32 hash, const struct Instance *inst)
{
	if (!inst) return NativeOnline_HashWord(hash, 0);
	hash = NativeOnline_HashWord(hash, inst->model ? inst->model->id : -1);
	hash = NativeOnline_HashWord(hash, inst->flags & ~DRAW_SUCCESSFUL);
	for (int i = 0; i < 3; i++) hash = NativeOnline_HashWord(hash, inst->matrix.t[i]);
	for (int row = 0; row < 3; row++) for (int col = 0; col < 3; col++) hash = NativeOnline_HashWord(hash, inst->matrix.m[row][col]);
	hash = NativeOnline_HashVec(hash, &inst->scale);
	hash = NativeOnline_HashWord(hash, inst->animIndex);
	return NativeOnline_HashWord(hash, inst->animFrame);
}
static u32 NativeOnline_HashThreadObject(u32 hash, const struct Thread *t)
{
	if (!t->object) return hash;
#define HASH(value) hash = NativeOnline_HashWord(hash, (u32)(value))
	if (t->funcThTick == RB_MovingExplosive_ThTick || t->funcThTick == RB_Warpball_ThTick ||
	    t->funcThTick == RB_Warpball_FadeAway || t->funcThTick == RB_Warpball_TurnAround)
	{
		const struct TrackerWeapon *w = t->object;
		HASH(1 + (t->funcThTick == RB_Warpball_FadeAway) + 2 * (t->funcThTick == RB_Warpball_TurnAround));
		HASH(NativeOnline_DriverID(w->driverParent)); HASH(NativeOnline_DriverID(w->driverTarget));
		hash = NativeOnline_HashVec(hash, &w->vel); hash = NativeOnline_HashVec(hash, &w->dir);
		HASH(w->flags); HASH(w->rotY); HASH(w->parentSafetyFrames); HASH(w->blindFrames);
		HASH(w->distanceToTarget); HASH(w->pathProgress); HASH(w->fadeFrame); HASH(w->driversHit);
		HASH(w->distFromGround); HASH(w->nodeCurrIndex); HASH(w->nodeNextIndex); HASH(w->timeAlive);
		hash = NativeOnline_HashVec(hash, &w->savedPos); HASH(w->turnAroundFrames); HASH(w->framesSeekTargetTnt);
	}
	else if (t->funcThTick == RB_GenericMine_ThTick || t->funcThTick == RB_TNT_ThTick_ThrowOffHead ||
	         t->funcThTick == RB_TNT_ThTick_SitOnHead || t->funcThTick == RB_TNT_ThTick_ThrowOnHead || t->funcThTick == RB_Potion_ThTick_InAir)
	{
		const struct MineWeapon *w = t->object;
		HASH(10 + (t->funcThTick == RB_TNT_ThTick_SitOnHead) + 2 * (t->funcThTick == RB_TNT_ThTick_ThrowOffHead) +
		     4 * (t->funcThTick == RB_TNT_ThTick_ThrowOnHead) + 8 * (t->funcThTick == RB_Potion_ThTick_InAir));
		HASH(NativeOnline_DriverID(w->driverTarget));
		for (int i = 0; i < 8; i++) if (sdata->gGT->drivers[i] && sdata->gGT->drivers[i]->instSelf == w->instParent) HASH(i + 1);
		hash = NativeOnline_HashVec(hash, &w->velocity); hash = NativeOnline_HashVec(hash, &w->deltaPos);
		HASH(w->stopFallAtY); HASH(w->boolDestroyed); HASH(w->numFramesOnHead); HASH(w->jumpsRemaining);
		HASH(w->parentSafetyFrames); HASH(w->tntSpinY); HASH(w->flags); HASH(w->cooldown);
	}
	else if (t->funcThTick == RB_ShieldDark_ThTick_Grow || t->funcThTick == RB_ShieldDark_ThTick_Pop)
	{
		const struct Shield *w = t->object;
		HASH(30 + (t->funcThTick == RB_ShieldDark_ThTick_Pop));
		HASH(w->animFrame); HASH(w->duration); HASH(w->flags); HASH(w->highlightTimer);
		hash = NativeOnline_HashVec(hash, &w->highlightRot);
	}
	else if (t->funcThTick == RB_MaskWeapon_ThTick || t->funcThTick == RB_MaskWeapon_FadeAway)
	{
		const struct MaskHeadWeapon *w = t->object;
		HASH(40 + (t->funcThTick == RB_MaskWeapon_FadeAway)); HASH(w->duration); HASH(w->scale);
		hash = NativeOnline_HashVec(hash, &w->rot); hash = NativeOnline_HashVec(hash, &w->pos);
	}
	else if (t->funcThTick == RB_RainCloud_ThTick || t->funcThTick == RB_RainCloud_FadeAway)
	{
		const struct RainCloud *w = t->object;
		HASH(50 + (t->funcThTick == RB_RainCloud_FadeAway)); HASH(w->timeMS); HASH(w->effect);
		if (w->rainLocal) { HASH(w->rainLocal->frameCount); hash = NativeOnline_HashVec(hash, &w->rainLocal->pos); hash = NativeOnline_HashVec(hash, &w->rainLocal->vel); }
	}
	else if (t->funcThTick == RB_CrateAny_ThTick_Grow)
	{
		const struct Crate *crate = t->object; HASH(60); HASH(crate->cooldown); HASH(crate->boolPauseCooldown);
	}
	// Read named hazard fields, excluding padding and presentation sound handles.
	else if (t->inst && t->inst->model)
	{
		switch (t->inst->model->id)
		{
		case ARMADILLO: {
			const struct Armadillo *w = t->object;
			hash = NativeOnline_HashVec(hash, &w->rotCurr); hash = NativeOnline_HashVec(hash, &w->rotDesired);
			HASH(w->velX); HASH(w->velZ); HASH(w->timeRolling); HASH(w->distFromSpawn);
			HASH(w->spawnPosX); HASH(w->spawnPosZ); HASH(w->direction); HASH(w->timeAtEdge); break; }
		case DYNAMIC_FIREBALL: {
			const struct Fireball *w = t->object; HASH(w->cycleTimer); HASH(w->fireballID); HASH(w->cooldown); HASH(w->velY); break; }
		case DYNAMIC_MINE_CART: {
			const struct Minecart *w = t->object;
			hash = NativeOnline_HashVec(hash, &w->posStart); hash = NativeOnline_HashVec(hash, &w->posEnd);
			hash = NativeOnline_HashVec(hash, &w->dir); hash = NativeOnline_HashVec(hash, &w->rotCurr); hash = NativeOnline_HashVec(hash, &w->rotDesired);
			HASH(w->betweenPoints_currFrame); HASH(w->betweenPoints_numFrames); HASH(w->posIndex); HASH(w->rotSpeed); break; }
		case PIRANHA_PLANT: {
			const struct Plant *w = t->object; HASH(w->cycleCount); HASH(w->cooldown); HASH(w->side); HASH(w->boolEatingPlayer); break; }
		case DYNAMIC_SEAL: {
			const struct Seal *w = t->object;
			hash = NativeOnline_HashVec(hash, &w->spawnPos); hash = NativeOnline_HashVec(hash, &w->endPos);
			hash = NativeOnline_HashVec(hash, &w->rotCurr); hash = NativeOnline_HashVec(hash, &w->rotDesired);
			hash = NativeOnline_HashVec(hash, &w->turnAroundRot); hash = NativeOnline_HashVec(hash, &w->vel);
			HASH(w->sealID); HASH(w->distFromSpawn); HASH(w->direction); HASH(w->numFramesSpinning); break; }
		case DYNAMIC_SNOWBALL: {
			const struct Snowball *w = t->object; HASH(w->pointIndex); HASH(w->numPoints); HASH(w->snowID); break; }
		case DYNAMIC_TURTLE: {
			const struct Turtle *w = t->object; HASH(w->timer); HASH(w->direction); HASH(w->turtleID); HASH(w->state); break; }
		default: break;
		}
	}
#undef HASH
	return hash;
}

static void NativeOnline_ObserveWorld(u8 **out)
{
	u32 words[NATIVE_ONLINE_WORLD_WORDS] = {0};
	struct GameTracker *gt = sdata->gGT;
	words[0] = 4;
	if (CTR_OnlineReady())
	{
		struct Level *level = gt->level1;
		words[2] = level ? level->numInstances : 0;
		words[3] = 2166136261u;
		for (u32 i = 0; level && i < level->numInstances; i++)
		{
			const struct InstDef *def = &level->ptrInstDefs[i];
			words[3] = NativeOnline_HashWord(words[3], def->modelID);
			words[3] = NativeOnline_HashWord(words[3], def->flags);
			words[3] = NativeOnline_HashInstance(words[3], def->ptrInstance);
		}
		for (int i = 0; i < 8; i++)
		{
			const struct Driver *d = gt->drivers[i];
			if (!d) continue;
			u32 *v = &words[8 + i * 16];
			v[0] = d->pendingDamageType; v[1] = NativeOnline_DriverID(d->pendingDamageAttacker);
			v[2] = d->pendingDamageReasonByte; v[3] = d->noItemTimer; v[4] = d->clockFlash;
			v[5] = d->superEngineTimer; v[6] = d->squishTimer; v[7] = d->numTimesAttacking;
			for (int attacker = 0; attacker < 8; attacker++) v[8] += d->numTimesAttackedByPlayer[attacker];
			v[9] = d->numTimesHitWeaponBox; v[10] = d->numTimesClockWeaponUsed;
			v[11] = d->numTimesMissileLaunched; v[12] = d->numTimesMissileHitSomeone; v[13] = d->numTimesBombsHitSomeone;
			if (d->instBubbleHold && d->instBubbleHold->thread && d->instBubbleHold->thread->object)
			{
				const struct Shield *shield = d->instBubbleHold->thread->object;
				v[14] = ((u32)(u16)shield->duration << 16) | shield->flags;
			}
			v[15] = d->instTntRecv ? 1 : 0;
		}
		for (int bucket = 0; bucket < NUM_BUCKETS; bucket++)
		{
			u32 count = 0, h1 = 2166136261u, h2 = 0x9e3779b9u;
			// Weapons can be children of player threads. Traverse the complete
			// bloodline, including driver children, without hashing driver pointers.
			struct Thread *pending[4096]; int pendingCount = 0;
			if (bucket < CAMERA && gt->threadBuckets[bucket].thread) pending[pendingCount++] = gt->threadBuckets[bucket].thread;
			while (pendingCount && count < 4096)
			{
				struct Thread *t = pending[--pendingCount];
				if (t->siblingThread && pendingCount < 4096) pending[pendingCount++] = t->siblingThread;
				if (t->childThread && pendingCount < 4096) pending[pendingCount++] = t->childThread;
				count++;
				h1 = NativeOnline_HashWord(h1, t->flags);
				h1 = NativeOnline_HashWord(h1, t->cooldownFrameCount);
				h1 = NativeOnline_HashInstance(h1, t->inst);
				if ((t->flags & 0xff) >= STATIC) h1 = NativeOnline_HashThreadObject(h1, t);
				h2 = NativeOnline_HashWord(h2, h1);
				if (t->funcThTick == RB_MovingExplosive_ThTick || t->funcThTick == RB_Warpball_ThTick) words[4]++;
				if (bucket == MINE) words[5]++;
				if (t->funcThTick == RB_ShieldDark_ThTick_Grow) words[6]++;
				if (t->funcThTick == RB_MaskWeapon_ThTick) words[7]++;
			}
			words[1] += count;
			words[136 + bucket * 3] = count;
			words[137 + bucket * 3] = h1;
			words[138 + bucket * 3] = h2;
		}
	}
	words[190] = gt->gameMode2; words[191] = gt->frozenTimeRemaining;
	// Mode setup, character ownership, cup advancement and battle scoring also
	// participate in diagnostics; menu decisions cannot silently diverge.
	words[192] = gt->numPlyrNextGame; words[193] = gt->numLaps;
	words[194] = gt->cup.cupID; words[195] = gt->cup.trackIndex;
	words[196] = gt->battleSetup.enabledWeapons; words[197] = gt->battleSetup.teamFlags;
	words[198] = gt->battleSetup.lifeLimit; words[199] = gt->battleSetup.killLimit;
	for (int i = 0; i < 8; i++) words[200 + i] = gt->cup.points[i];
	for (int i = 0; i < 4; i++) {
		words[208 + i] = GAME_CHARACTER_IDS[i];
		words[212 + i] = gt->battleSetup.pointsPerTeam[i];
		words[216 + i] = gt->battleSetup.teamOfEachPlayer[i];
	}
	if (s_onlineMenuFlow && gt->levelID == MAIN_MENU_LEVEL && sdata->Loading.stage == LOAD_IDLE) {
		words[220] = MM_MENU_MAIN.rowSelected;
		words[221] = CTR_WebMenuInfo(7);
		words[222] = MM_MENU_TRACK_SELECT.rowSelected;
		words[223] = MM_MENU_CUP_SELECT.rowSelected;
	}
	for (int i = 0; i < 4; i++) {
		words[224 + i] = CTR_OnlineReady() && gt->drivers[i] ? gt->drivers[i]->BattleHUD.numLives : 0;
		words[228 + i] = gt->battleSetup.finishedRankOfEachTeam[i];
		words[248 + i] = gt->battleSetup.standingsScore[i];
		words[252 + i] = gt->battleSetup.standingsOrder[i];
	}
	for (int i = 0; i < 12; i++) words[232 + i] = gt->standingsPoints[i];
	words[244] = gt->originalEventTime; words[245] = gt->arcadeDifficulty;
	words[246] = gt->numBotsNextGame; words[247] = gt->gameModeEnd;
	for (int i = 0; i < NATIVE_ONLINE_WORLD_WORDS; i++) NativeOnline_WriteWord(out, words[i]);
}
