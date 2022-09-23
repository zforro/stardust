import { STARDUST } from '../config.js';

//------------------------------------------------------------------------------

export const logs = global.stardustLogs = []; // TODO: write access helpers

export const starLog = (funcName, message, content) => {
  if (logs.length >= STARDUST.logs.bufferSize) {
    logs.shift();
  }
  addLog(logs, {func: funcName, message, ...content});
};

const addLog = (logs, content) => {
  logs.push({
    ...content
  });
};
