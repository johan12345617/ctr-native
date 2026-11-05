#ifndef PLATFORM_NATIVE_GL_H
#define PLATFORM_NATIVE_GL_H

#if defined(__EMSCRIPTEN__)
#include <GLES3/gl3.h>
#else
#include "platform/native_glad.h"
#endif

#endif
