export function logTimestampedMessage(message, level = 'log') {
    const timestampedMessage = `${new Date().toISOString()}: ${message}`;
    if (level === 'error') {
      console.error(timestampedMessage);
    } else {
      console.log(timestampedMessage);
    }
  }
  