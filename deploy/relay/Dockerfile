# OpenFini collaboration relay: one dependency-free Node file. Build from the repository root:
#   docker build -f deploy/relay/Dockerfile -t openfini-relay .
# Run behind a TLS reverse proxy or tunnel; set OPENFINI_RELAY_TOKEN to require ?key=<token> in the relay address.
FROM node:22-alpine
WORKDIR /relay
COPY scripts/relay.mjs ./relay.mjs
USER node
EXPOSE 8787
CMD ["node", "relay.mjs", "--host", "0.0.0.0", "--port", "8787"]
