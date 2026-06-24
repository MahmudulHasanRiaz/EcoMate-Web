#include <napi.h>
#include <string>
#include <vector>
#include <sstream>

namespace {

Napi::String VerifyLicense(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
    return Napi::String::New(env, "");
  }

  std::string token = info[0].As<Napi::String>().Utf8Value();

  std::vector<std::string> parts;
  std::stringstream ss(token);
  std::string part;
  while (std::getline(ss, part, '.')) {
    parts.push_back(part);
  }

  if (parts.size() != 3) {
    return Napi::String::New(env, "{\"valid\":false,\"reason\":\"malformed\"}");
  }

  return Napi::String::New(env, "{\"valid\":true,\"payload\":\"" + parts[1] + "\"}");
}

}

Napi::Object InitValidator(Napi::Env env, Napi::Object exports) {
  exports.Set("verifyLicense", Napi::Function::New(env, VerifyLicense));
  return exports;
}
