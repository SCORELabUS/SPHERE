FROM nginx:1.28.0-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY identity.conf.template /etc/nginx/scoretech/identity.conf.template
COPY identity-proxy.conf /etc/nginx/scoretech/proxy.conf
COPY cas-callback.conf /etc/nginx/scoretech/cas-callback.conf
COPY --chmod=755 15-scoretech-mode.sh /docker-entrypoint.d/15-scoretech-mode.sh
