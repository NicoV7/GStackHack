FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

ARG GBRAIN_REF=17b190e22781b822177235ce3d2a4ae2833a6b27
ENV BUN_INSTALL=/root/.bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
ENV GBRAIN_ROOT=/opt/gbrain
ENV GBRAIN_CLI=/opt/gbrain/src/cli.ts

RUN curl -fsSL https://bun.sh/install | bash

# The npm package named "gbrain" is unrelated. Use the official source repo.
RUN git clone https://github.com/garrytan/gbrain.git "${GBRAIN_ROOT}" \
  && cd "${GBRAIN_ROOT}" \
  && git checkout "${GBRAIN_REF}" \
  && bun install

COPY start.sh /usr/local/bin/start-gbrain
RUN chmod +x /usr/local/bin/start-gbrain

# Expose the MCP HTTP server port
EXPOSE 4100

# Run gbrain serve with HTTP mode. start.sh respects Azure's PORT env.
CMD ["start-gbrain"]
