const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL || "http://127.0.0.1:4000/health";
const MAX_RETRIES = Number(process.env.HEALTHCHECK_MAX_RETRIES || 20);
const RETRY_DELAY_MS = Number(process.env.HEALTHCHECK_RETRY_DELAY_MS || 500);
const REQUEST_TIMEOUT_MS = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 2000);

const isPositiveInt = (value) => Number.isInteger(value) && value > 0;

if (!isPositiveInt(MAX_RETRIES) || !isPositiveInt(RETRY_DELAY_MS) || !isPositiveInt(REQUEST_TIMEOUT_MS)) {
  console.error("Invalid smoke check configuration. Retry/timeouts must be positive integers.");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requestHealth = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(HEALTHCHECK_URL, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Unexpected status: ${response.status}`);
    }

    const payload = await response.json().catch(() => ({}));
    if (!payload || payload.ok !== true) {
      throw new Error("Health payload missing ok=true");
    }
  } finally {
    clearTimeout(timeout);
  }
};

let lastError = null;
for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
  try {
    await requestHealth();
    console.log(`Health smoke check passed on attempt ${attempt}: ${HEALTHCHECK_URL}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS);
    }
  }
}

console.error(`Health smoke check failed after ${MAX_RETRIES} attempts: ${HEALTHCHECK_URL}`);
if (lastError) {
  console.error(String(lastError.message || lastError));
}
process.exit(1);
