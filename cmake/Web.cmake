# Keep the original 32-bit game and PSX facade; only the host changes.
set_target_properties(ctr_native PROPERTIES SUFFIX ".js")
target_link_options(ctr_native PRIVATE
    -sMIN_WEBGL_VERSION=2
    -sMAX_WEBGL_VERSION=2
    -sASYNCIFY=1
    -sASYNCIFY_STACK_SIZE=131072
    -sSTACK_SIZE=4194304
    -sINITIAL_MEMORY=134217728
    -sALLOW_MEMORY_GROWTH=1
    -sMAXIMUM_MEMORY=1073741824
    # Retail callbacks sometimes cast between function pointer signatures.
    -sEMULATE_FUNCTION_POINTER_CASTS=1
    -sFORCE_FILESYSTEM=1
    -sMODULARIZE=1
    -sEXPORT_NAME=createCTRModule
    -sENVIRONMENT=web
    "-sEXPORTED_RUNTIME_METHODS=['FS','IDBFS','callMain']"
    "-sEXPORTED_FUNCTIONS=['_main','_CTR_WebSetPad','_CTR_WebClearPad','_CTR_WebSetKeyboardPlayer','_CTR_WebGetKeyboardPlayer']"
    -lidbfs.js
)

find_program(CTR_NODE_EXECUTABLE NAMES node REQUIRED)
set(CTR_TAILWIND_CLI "${CMAKE_SOURCE_DIR}/web/node_modules/@tailwindcss/cli/dist/index.mjs")
if(NOT EXISTS "${CTR_TAILWIND_CLI}")
    message(FATAL_ERROR "Install web styling dependencies first: npm --prefix web ci")
endif()
add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/styles.css"
    COMMAND "${CTR_NODE_EXECUTABLE}" "${CTR_TAILWIND_CLI}"
        --input "${CMAKE_SOURCE_DIR}/web/styles.css"
        --output "${CMAKE_BINARY_DIR}/styles.css" --minify
    DEPENDS web/styles.css web/index.html web/app.js web/online.js
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}/web"
    VERBATIM
)
add_custom_target(ctr_web_styles DEPENDS "${CMAKE_BINARY_DIR}/styles.css")
add_dependencies(ctr_native ctr_web_styles)
foreach(web_file index.html app.js online.js input.js)
    configure_file("web/${web_file}" "${CMAKE_BINARY_DIR}/${web_file}" COPYONLY)
endforeach()
