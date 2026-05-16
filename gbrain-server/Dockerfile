FROM oven/bun:latest

# Pin the CLI version used by local development.
RUN bun install -g gbrain@0.33.0

COPY start.sh /usr/local/bin/start-gbrain
RUN chmod +x /usr/local/bin/start-gbrain

# Expose the MCP HTTP server port
EXPOSE 4100

# Run gbrain serve with HTTP mode. start.sh respects Azure's PORT env.
CMD ["start-gbrain"]
