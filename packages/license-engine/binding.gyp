{
  "targets": [
    {
      "target_name": "license_engine",
      "sources": ["src/addon.cc", "src/validator.cc"],
      "include_dirs": ["../../node_modules/node-addon-api"],
      "defines": ["NAPI_CPP_EXCEPTIONS"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "OTHER_CPLUSPLUSFLAGS": ["-fexceptions"]
      }
    }
  ]
}
