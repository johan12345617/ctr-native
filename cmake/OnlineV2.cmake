# Isolated Node worker, using the original C simulation and CPU-only VRAM.
set_target_properties(ctr_native PROPERTIES SUFFIX ".cjs")
target_link_options(ctr_native PRIVATE
    -sSTACK_SIZE=4194304
    -sINITIAL_MEMORY=134217728
    -sALLOW_MEMORY_GROWTH=1
    -sMAXIMUM_MEMORY=1073741824
    -sEMULATE_FUNCTION_POINTER_CASTS=1
    -sFORCE_FILESYSTEM=1
    -sMODULARIZE=1
    -sEXPORT_NAME=createCTRModule
    -sENVIRONMENT=node
    -sEXIT_RUNTIME=0
    "-sEXPORTED_RUNTIME_METHODS=['FS','NODEFS','callMain','HEAPU8']"
    "-sEXPORTED_FUNCTIONS=['_main','_malloc','_free']"
    -lnodefs.js
)
