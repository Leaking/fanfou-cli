import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizationHeader, percentEncode, fanfouSignatureURL } from "../src/oauth1.ts";

test("matches the canonical RFC 5849 example signature", () => {
  const header = authorizationHeader({
    method: "GET",
    url: new URL("http://photos.example.net/photos?file=vacation.jpg&size=original"),
    consumerKey: "dpf43f3p2l4k3l03",
    consumerSecret: "kd94hf93k423kf44",
    token: "nnch734d00sl2jdk",
    tokenSecret: "pfkkdhi9sl3r4s00",
    nonce: "kllo9940pd9333jh",
    timestampSeconds: "1191242096",
  });
  assert.match(header, /oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"/);
});

test("xauth parameters are signed and included in the header", () => {
  const header = authorizationHeader({
    method: "GET",
    url: new URL("https://fanfou.com/oauth/access_token"),
    consumerKey: "consumer",
    consumerSecret: "secret",
    extraParameters: [
      ["x_auth_username", "name@example.com"],
      ["x_auth_password", "pass word"],
      ["x_auth_mode", "client_auth"],
    ],
    nonce: "nonce",
    timestampSeconds: "1234567890",
  });
  assert.match(header, /x_auth_username="name%40example.com"/);
  assert.match(header, /x_auth_password="pass%20word"/);
  assert.match(header, /x_auth_mode="client_auth"/);
  assert.match(header, /oauth_signature=/);
});

test("percentEncode follows RFC 3986 unreserved set", () => {
  assert.equal(percentEncode("a b+c*d(e)"), "a%20b%2Bc%2Ad%28e%29");
  assert.equal(percentEncode("AZaz09-._~"), "AZaz09-._~");
});

test("fanfou signature url downgrades https to http", () => {
  assert.equal(fanfouSignatureURL(new URL("https://api.fanfou.com/x.json")).protocol, "http:");
  assert.equal(fanfouSignatureURL(new URL("https://example.com/x")).protocol, "https:");
});
