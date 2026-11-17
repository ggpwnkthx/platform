# PostgreSQL 18 with the OAuth token validator that Platform's logins depend on.
# PostgreSQL ships the oauth authentication method but no validator; this adds
# https://github.com/percona/pg_oidc_validator, built from a pinned, checksummed release.
ARG POSTGRES_VERSION=18
FROM docker.io/library/postgres:${POSTGRES_VERSION} AS validator
ARG VALIDATOR_VERSION=1.1.0
ARG VALIDATOR_SHA256=6e2fc7f6b15dae6a006a32665426bb9f5ccce22890c684ccb078c35b0fc9d578
# APT::Sandbox::User=root: apt's unprivileged download user does not exist in a rootless build
# that maps a single UID.
RUN apt-get -o APT::Sandbox::User=root update \
 && apt-get -o APT::Sandbox::User=root install -y --no-install-recommends ca-certificates curl g++ make \
      libcurl4-openssl-dev libssl-dev "postgresql-server-dev-${PG_MAJOR}" \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSL -o validator.tar.gz \
      "https://github.com/percona/pg_oidc_validator/archive/refs/tags/${VALIDATOR_VERSION}.tar.gz" \
 && echo "${VALIDATOR_SHA256}  validator.tar.gz" | sha256sum -c - \
 && tar xzf validator.tar.gz --strip-components=1 \
 && make USE_PGXS=1 with_llvm=no -j"$(nproc)" \
 && make USE_PGXS=1 with_llvm=no install DESTDIR=/out

FROM docker.io/library/postgres:${POSTGRES_VERSION}
RUN apt-get -o APT::Sandbox::User=root update \
 && apt-get -o APT::Sandbox::User=root install -y --no-install-recommends ca-certificates libcurl4t64 \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -o postgres -g postgres -m 0700 /etc/platform
COPY --from=validator /out/usr/lib/postgresql/ /usr/lib/postgresql/
COPY --chmod=0755 entrypoint.sh /usr/local/bin/platform-postgres
ENTRYPOINT ["platform-postgres"]
CMD ["postgres"]
