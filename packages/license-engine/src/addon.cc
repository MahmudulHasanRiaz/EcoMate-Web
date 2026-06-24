#include <napi.h>

Napi::Object InitValidator(Napi::Env env, Napi::Object exports);

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  InitValidator(env, exports);
  return exports;
}

NODE_API_MODULE(license_engine, InitAll)
