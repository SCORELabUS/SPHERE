import {
  ChatRequest,
  PricingContextItem,
  PricingContextPayload,
  PricingContextUrlWithId,
} from "./types/types";

const HARVEY_API_BASE_URL =
  import.meta.env.VITE_HARVEY_URL ?? "http://localhost:8086";

export function extractPricingUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)]+/gi) ?? [];
  const urls: string[] = [];

  matches.forEach((raw) => {
    const candidate = raw.replace(/[),.;]+$/, "");
    try {
      const url = new URL(candidate);
      if (!urls.includes(url.href)) {
        urls.push(url.href);
      }
    } catch (error) {
      console.warn("Detected invalid pricing URL candidate", candidate, error);
    }
  });

  return urls;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function extractHttpReferences(payload: unknown): string[] {
  const results = new Set<string>();
  const visited = new Set<unknown>();

  const visit = (value: unknown) => {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === "string") {
      if (isHttpUrl(value)) {
        results.add(value);
      }
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    Object.values(value).forEach(visit);
  };

  visit(payload);
  return Array.from(results);
}

export async function uploadYamlPricing(
  filename: string,
  content: string
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new File([content], filename, { type: "application/yaml" })
  );
  const response = await fetch(HARVEY_API_BASE_URL + "/upload", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Upload failed for ${filename}`);
  }

  const json = await response.json();
  return json.filename;
}

export async function deleteYamlPricing(filename: string): Promise<void> {
  const response = await fetch(HARVEY_API_BASE_URL + "/pricing/" + filename, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Cannot delete item ${filename}`);
  }
}

export function diffPricingContextWithDetectedUrls(
  pricingContext: PricingContextItem[],
  detectedPricingUrls: string[]
): string[] {
  const contextUrls = pricingContext
    .filter((item) => item.kind === "url")
    .map((item) => item.url);
  return detectedPricingUrls.filter(
    (detectedUrl) => !contextUrls.includes(detectedUrl)
  );
}

export const createContextBodyPayload = (
  urls: PricingContextUrlWithId[],
  yamls: string[]
): PricingContextPayload => {
  const payload = {} as PricingContextPayload;
  if (urls.length === 1) {
    payload.pricing_url = urls[0];
  } else if (urls.length > 1) {
    payload.pricing_urls = urls;
  }

  if (yamls.length === 1) {
    payload.pricing_yaml = yamls[0];
  } else if (yamls.length > 1) {
    payload.pricing_yamls = yamls;
  }

  return payload;
};

export async function chatWithAgent(body: ChatRequest) {
  const response = await fetch(`${HARVEY_API_BASE_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `API returned ${response.status}`;
    try {
      const detail = await response.json();
      if (typeof detail?.detail === "string") {
        message = detail.detail;
      }
    } catch (parseError) {
      console.error("Failed to parse error response", parseError);
    }
    throw new Error(message);
  }

  return await response.json();
}
