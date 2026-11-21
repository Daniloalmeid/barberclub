"use strict";

const http = require("node:http");
const emit = http.Server.prototype.emit;

http.Server.prototype.emit = function (event, req, ...rest) {
  if ((event === "request" || event === "upgrade") && req && typeof req.url === "string") {
    const match = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)(\?[^#]*)?/i.exec(req.url);
    if (match) req.url = `${match[1] || "/"}${match[2] || ""}`;
  }
  return emit.call(this, event, req, ...rest);
};
