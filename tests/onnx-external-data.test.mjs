import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const {
  isSafeExternalLocation,
  OnnxExternalDataError,
  readOnnxExternalDataLocations
} = await import("../src/lib/model-delivery/onnx-external-data.ts");

test("streams external-data locations from initializers without reading tensor payloads", async () => {
  const tensor = message(
    bytesField(9, new Uint8Array(96 * 1024).fill(7)),
    externalDataEntry("location", "model_q4f16.onnx_data"),
    varintField(14, 1)
  );
  const graph = message(bytesField(5, tensor));
  const model = message(bytesField(7, graph));

  assert.deepEqual(
    await readOnnxExternalDataLocations(new Blob([model])),
    ["model_q4f16.onnx_data"]
  );
});

test("finds external tensors nested inside node graph attributes and deduplicates locations", async () => {
  const tensor = message(
    externalDataEntry("location", "weights/shard-01.bin"),
    externalDataEntry("offset", "0")
  );
  const nestedGraph = message(bytesField(5, tensor));
  const attribute = message(bytesField(6, nestedGraph));
  const node = message(bytesField(5, attribute));
  const graph = message(bytesField(1, node), bytesField(5, tensor));
  const model = message(bytesField(7, graph));

  assert.deepEqual(
    await readOnnxExternalDataLocations(new Blob([model])),
    ["weights/shard-01.bin"]
  );
});

test("skips valid 64-bit protobuf integers without converting them to JavaScript numbers", async () => {
  const signedInt64 = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
  const attribute = message(
    Uint8Array.from([...varint(3 << 3), ...signedInt64]),
    bytesField(5, message(externalDataEntry("location", "model_q4.onnx_data")))
  );
  const node = message(bytesField(5, attribute));
  const model = message(bytesField(7, message(bytesField(1, node))));

  assert.deepEqual(
    await readOnnxExternalDataLocations(new Blob([model])),
    ["model_q4.onnx_data"]
  );
});

test("rejects unsafe external-data locations", async () => {
  const tensor = message(externalDataEntry("location", "../private/model.bin"));
  const model = message(bytesField(7, message(bytesField(5, tensor))));

  await assert.rejects(
    readOnnxExternalDataLocations(new Blob([model])),
    (error) => error instanceof OnnxExternalDataError && /unsafe external-data path/.test(error.message)
  );
  assert.equal(isSafeExternalLocation("weights/model.bin"), true);
  assert.equal(isSafeExternalLocation("/weights/model.bin"), false);
  assert.equal(isSafeExternalLocation("weights\\model.bin"), false);
  assert.equal(isSafeExternalLocation("weights/%2e%2e/model.bin"), false);
});

test("fails closed on truncated protobuf messages", async () => {
  const truncatedModel = Uint8Array.from([...varint((7 << 3) | 2), ...varint(10), 1, 2]);

  await assert.rejects(
    readOnnxExternalDataLocations(new Blob([truncatedModel])),
    (error) => error instanceof OnnxExternalDataError && /truncated protobuf message/.test(error.message)
  );
});

function externalDataEntry(key, value) {
  const entry = message(
    bytesField(1, new TextEncoder().encode(key)),
    bytesField(2, new TextEncoder().encode(value))
  );
  return bytesField(13, entry);
}

function varintField(field, value) {
  return Uint8Array.from([...varint(field << 3), ...varint(value)]);
}

function bytesField(field, value) {
  return Uint8Array.from([...varint((field << 3) | 2), ...varint(value.length), ...value]);
}

function message(...fields) {
  const size = fields.reduce((total, field) => total + field.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const field of fields) {
    result.set(field, offset);
    offset += field.length;
  }
  return result;
}

function varint(value) {
  const bytes = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return bytes;
}
