FROM alpine:3.22
RUN apk add --no-cache openssh-server && adduser -D demo && passwd -d demo
COPY containers/sshd_config /etc/ssh/sshd_config
EXPOSE 2222 5432
CMD ["/bin/sh", "-c", "mkdir -p /run/sshd && chmod 0755 /run /run/sshd && exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config"]
