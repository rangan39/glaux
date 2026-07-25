# Sophon offline model packs

Sophon model packs are versioned, data-only containers for installing one allowlisted Tiny Aya q4f16 model from a local file. They do not extend the model catalog and cannot supply executable code, URLs, runtime options, paths, or trust metadata.

## Version 1 binary format

All integer fields are unsigned 32-bit little-endian:

```text
offset  size  field
0       18    ASCII "SOPHON_MODEL_PACK\0"
18      4     format version (= 1)
22      4     canonical JSON header byte length (1..1,048,576)
26      n     canonical UTF-8 JSON header
26+n    ...   artifact payloads concatenated at declared relative offsets
```

The JSON object contains:

```json
{
  "schemaVersion": 1,
  "modelId": "tiny-aya-global",
  "repo": "onnx-community/tiny-aya-global-ONNX",
  "revision": "7fff1be9627e40f0d89c33f406882bdafb56ec90",
  "quantization": "q4f16",
  "segmentSize": 67108864,
  "artifacts": [
    {
      "path": "config.json",
      "offset": 0,
      "size": 2318,
      "sha256": "<whole-file digest>",
      "segments": ["<64 MiB-or-smaller segment digest>"]
    }
  ],
  "license": {
    "spdx": "CC-BY-NC-4.0",
    "modelCardUrl": "https://huggingface.co/CohereLabs/tiny-aya-global",
    "acceptableUsePolicyUrl": "https://docs.cohere.com/docs/cohere-labs-acceptable-use-policy",
    "attribution": "Tiny Aya Global by Cohere Labs, licensed under CC BY-NC 4.0 for non-commercial use."
  }
}
```

Canonical JSON recursively sorts object keys, has no insignificant whitespace, uses UTF-8, and permits only JSON null/booleans/strings, arrays, objects, and safe integers. Artifacts are sorted by path and have contiguous, non-overlapping offsets beginning at zero. The file must end exactly after the final artifact.

Version 1 authenticity is anchored entirely in Sophon's compiled immutable manifest. Every identity field, artifact path, byte size, whole digest, segment digest, and license field must match it exactly. Header digests alone are never trusted. Supporting a remotely updated catalog would require separately signed metadata and is outside version 1.

## Build and verify

Prepare a directory containing exactly the seven upstream files pinned for one model in `models/model-artifacts.seed.json`. Then, only after the intended distribution has completed license and attribution review:

```bash
npm run model-pack -- build \
  --model-id tiny-aya-global \
  --artifact-dir artifacts/models/tiny-aya-global-source \
  --output artifacts/models/tiny-aya-global.sophon-model \
  --license-reviewed
```

The build refuses an unknown model, mutable revision, missing/unknown file, symlink, size mismatch, hash mismatch, missing license metadata, or existing output. It never buffers a complete artifact or pack. Identical seed and artifact bytes produce byte-identical pack output.

The command verifies the finished pack and emits:

- `tiny-aya-global.sophon-model`
- `tiny-aya-global.sophon-model.sha256`
- `tiny-aya-global.sophon-model.provenance.txt`

Run verification again on another machine or before distribution:

```bash
npm run model-pack -- verify \
  --pack artifacts/models/tiny-aya-global.sophon-model \
  --model-id tiny-aya-global
```

The `--license-reviewed` flag records that the operator has passed the build gate; it is not itself legal approval or permission to redistribute Tiny Aya weights.

## Install in the web app or extension

1. Open the model library.
2. Choose **Import offline pack** for the intended Tiny Aya region.
3. Select the `.sophon-model` file.
4. Review its model, immutable revision, model and free-space sizes, source, attribution, model card, CC BY-NC non-commercial restriction, and Cohere Labs AUP.
5. Accept the terms and choose **Import and verify**.
6. Wait for `Validating → Importing → Verifying → Ready`.

After `Ready`, the model uses the same OPFS, IndexedDB, and CacheStorage layout as an online download. It can run with the network disconnected and is indistinguishable to selection, cache inventory, session rehash, and deletion.

Web and extension origins remain isolated. Import the same pack separately into each origin that needs the model.

## Failure and recovery

- **Cancelled/reloaded:** flushed verified 64 MiB checkpoints remain partial. Re-select the same pack to resume.
- **Wrong model or revision:** select the pack matching the chosen region and current Sophon release.
- **Unsupported format:** rebuild with the current version-1 tooling or update Sophon when a later format is explicitly supported.
- **Corrupt segment or whole digest:** discard and re-download/rebuild the pack. The model is never marked ready.
- **Truncated or trailing data:** replace the file with its published size/checksum match.
- **License mismatch:** use a pack built from Sophon's exact reviewed seed; pack-supplied license changes are rejected.
- **Insufficient quota/write failure:** delete another cached model or free device storage, then retry. Verified checkpoints remain recoverable when durable.
- **Concurrent activity:** wait for the active import, online download, inference startup, or deletion holding the model lock to finish, or cancel the active operation.

Deleting an imported model uses the normal model-library trash action and removes its OPFS files, IndexedDB checkpoints, and Transformers.js cache entries. It never deletes the user-owned source pack.

## Security and performance invariants

- At most 1 MiB of header data is decoded.
- Payloads are read with `Blob.slice().stream()`; the full pack is never copied or passed through `arrayBuffer()`/`text()`.
- External weights stream directly to final OPFS offsets and use the compiled 64 MiB segment digests.
- Small auxiliary artifacts are bounded to the compiled sizes before entering CacheStorage.
- Paths reject traversal, separators outside `/`, duplicates, Unicode lookalikes, gaps, overlaps, unsafe integers, and unknown entries.
- Segment checkpoints follow `hash → write → flush → strict IndexedDB commit`.
- The final external-artifact `ready` transition is one strict IndexedDB transaction after whole-file verification.
- Online download remains the default recovery path.
- Packs and weights are ignored by Git and explicitly rejected from Chrome-extension build output.
