FROM oven/bun:latest

# Install gbrain globally
RUN bun install -g gbrain

# Initialize a fresh brain with PGLite
RUN gbrain init --pglite

# Expose the MCP HTTP server port
EXPOSE 4100

# Run gbrain serve with HTTP mode
CMD ["gbrain", "serve", "--http", "--port", "4100"]
