// CPU VRAM for the Online 2.0 feasibility worker. The game still builds its
// display lists (some presentation code affects RNG); no window or GPU is used.
#include "platform/native_renderer.h"
#include <string.h>

int g_windowWidth, g_windowHeight;
int g_dbg_wireframeMode, g_dbg_texturelessMode, g_cfg_bilinearFiltering;
static u16 s_headlessVRAM[VRAM_WIDTH * VRAM_HEIGHT];
static u16 s_headlessCopy[VRAM_WIDTH * VRAM_HEIGHT];

int NativeRenderer_InitialiseRender(char *name, int w, int h, int fullscreen)
{
	(void)name; (void)fullscreen; g_windowWidth = w; g_windowHeight = h; return 1;
}
int NativeRenderer_InitialisePSX(void) { return 1; }
void NativeRenderer_Shutdown(void) {}
void NativeRenderer_ResetDevice(void) {}
void NativeRenderer_BeginScene(void) {}
void NativeRenderer_EndScene(void) {}
void NativeRenderer_EndGpuFrame(void) {}
void NativeRenderer_FinishGpuMeasurements(void) {}
void NativeRenderer_UpdateSwapIntervalState(int interval) { (void)interval; }
void NativeRenderer_SwapWindow(void) {}
void NativeRenderer_StoreFrameBuffer(int x, int y, int w, int h) { (void)x; (void)y; (void)w; (void)h; }
void NativeRenderer_PresentVRAMDisplay(void) {}
void NativeRenderer_PresentVRAMRect(int x, int y, int w, int h) { (void)x; (void)y; (void)w; (void)h; }
void NativeRenderer_SaveVRAM(const char *path, int x, int y, int w, int h, int readback)
{ (void)path; (void)x; (void)y; (void)w; (void)h; (void)readback; }
void NativeRenderer_Clear(int x, int y, int w, int h, u8 r, u8 g, u8 b)
{ (void)x; (void)y; (void)w; (void)h; (void)r; (void)g; (void)b; }
void NativeRenderer_ClearVRAM(int x, int y, int w, int h, u8 r, u8 g, u8 b)
{
	u16 pixel = (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10);
	for (int row = 0; row < h; row++) for (int col = 0; col < w; col++)
		if ((unsigned)(x + col) < VRAM_WIDTH && (unsigned)(y + row) < VRAM_HEIGHT)
			s_headlessVRAM[(y + row) * VRAM_WIDTH + x + col] = pixel;
}
void NativeRenderer_CopyVRAM(u16 *src, int x, int y, int w, int h, int dx, int dy)
{
	if (w <= 0 || h <= 0 || w > VRAM_WIDTH || h > VRAM_HEIGHT) return;
	int stride = src ? w : VRAM_WIDTH;
	if (!src) src = s_headlessVRAM;
	for (int row = 0; row < h; row++) for (int col = 0; col < w; col++)
	{
		int sx = x + col, sy = y + row;
		s_headlessCopy[row * w + col] = (sx >= 0 && sx < stride && sy >= 0 && sy < VRAM_HEIGHT)
		    ? src[sy * stride + sx] : 0;
	}
	for (int row = 0; row < h; row++) for (int col = 0; col < w; col++)
		if ((unsigned)(dx + col) < VRAM_WIDTH && (unsigned)(dy + row) < VRAM_HEIGHT)
			s_headlessVRAM[(dy + row) * VRAM_WIDTH + dx + col] = s_headlessCopy[row * w + col];
}
void NativeRenderer_ReadVRAM(u16 *dst, int x, int y, int w, int h)
{
	for (int row = 0; row < h; row++) for (int col = 0; col < w; col++)
		dst[row * w + col] = ((unsigned)(x + col) < VRAM_WIDTH && (unsigned)(y + row) < VRAM_HEIGHT)
		    ? s_headlessVRAM[(y + row) * VRAM_WIDTH + x + col] : 0;
}
void NativeRenderer_UpdateVRAM(void) {}
int NativeRenderer_GetVRAMStateSize(void) { return sizeof(s_headlessVRAM); }
int NativeRenderer_CaptureVRAMState(void *dst, int size)
{
	if (!dst || size != sizeof(s_headlessVRAM)) return 0;
	memcpy(dst, s_headlessVRAM, size); return 1;
}
int NativeRenderer_RestoreVRAMState(const void *src, int size)
{
	if (!src || size != sizeof(s_headlessVRAM)) return 0;
	memcpy(s_headlessVRAM, src, size); return 1;
}
TextureID NativeRenderer_GetVRAMTexture(void) { return 0; }
TextureID NativeRenderer_GetWhiteTexture(void) { return 0; }
void NativeRenderer_SetBlendMode(BlendMode mode) { (void)mode; }
void NativeRenderer_SetStencilMode(int mode) { (void)mode; }
void NativeRenderer_SetOffscreenState(const RECT16 *rect, int enabled) { (void)rect; (void)enabled; }
void NativeRenderer_SetProjection(const RECT16 *rect, const DISPENV *env, int offscreen) { (void)rect; (void)env; (void)offscreen; }
void NativeRenderer_SetupClipMode(const RECT16 *rect, const DISPENV *env, int enabled) { (void)rect; (void)env; (void)enabled; }
void NativeRenderer_SetTexture(TextureID texture, TexFormat format) { (void)texture; (void)format; }
void NativeRenderer_SetOverrideTextureSize(int w, int h) { (void)w; (void)h; }
void NativeRenderer_SetPSXTextureSemiTransPass(int pass) { (void)pass; }
void NativeRenderer_SetPSXTextureOutputSTP(int enabled) { (void)enabled; }
void NativeRenderer_SetPSXDrawMaskSet(int enabled) { (void)enabled; }
void NativeRenderer_UpdateVertexBuffer(const GrVertex *vertices, int count) { (void)vertices; (void)count; }
void NativeRenderer_DrawTriangles(int start, int count) { (void)start; (void)count; }
void NativeRenderer_PushDebugLabel(const char *label) { (void)label; }
void NativeRenderer_PopDebugLabel(void) {}
