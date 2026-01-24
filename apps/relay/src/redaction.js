const redactKeyPattern = /(token|secret|password|api[_-]?key)/i;

export const redactObject = (value, key) => {
  if (key && redactKeyPattern.test(key)) {
    return "[redacted]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactObject(childValue, childKey),
      ])
    );
  }

  return value;
};

export const redactMessage = (message) => {
  if (!message || typeof message !== "object") {
    return message;
  }

  return {
    ...message,
    agent_states: redactObject(message.agent_states),
    session_summary: redactObject(message.session_summary),
    payload: redactObject(message.payload),
  };
};
