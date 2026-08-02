export async function prepareCommunityModelDelivery(descriptor) {
  return {
    plan: { descriptorId: descriptor.id },
    graph: {
      url: `https://huggingface.co/${descriptor.source.repo}/resolve/${descriptor.source.revision}/${descriptor.format.graphPath}`,
      data: new File([new Uint8Array(1024)], "model.onnx")
    },
    externalData: [],
    totalBytes: descriptor.format.totalBytes
  };
}

export async function deleteCommunityModelDelivery() {}

export function createCommunityModelCache() {
  return {
    async match() { return undefined; },
    async put() {}
  };
}
