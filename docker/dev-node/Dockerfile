ARG NODE_VERSION="latest"

FROM node:${NODE_VERSION}

LABEL maintainer="Andy Deng <andy.z.deng@gmail.com>"

COPY wait_to_run.sh /opt

RUN chmod 644 /opt/wait_to_run.sh && \
    apt-get update && \
    apt-get -y upgrade && \
    ACCEPT_EULA=Y DEBIAN_FRONTEND=noninteractive apt-get install -y \
        lsof \
        netcat \
        net-tools \
        telnet \
        vim \
        psmisc \
        sudo \
        unzip \
        tzdata \
        && \
    apt-get autoclean && \
    useradd user -m -s /bin/bash && \
    mkdir -p /opt/workspace && \
    chown user:user /opt/workspace && \
    chmod u+w /etc/sudoers && \
    echo 'user    ALL=(ALL)    NOPASSWD:ALL' > /etc/sudoers && \
    chmod u-w /etc/sudoers

ENV PROJECT_PATH= \
    RUN_CMD= \
    INIT_FILE= \
    WAIT_SEC=0 \
    WAIT_HOST= \
    WAIT_PORT=

USER user

VOLUME [ "/home/user" ]

WORKDIR /opt/workspace

CMD sh /opt/wait_to_run.sh /opt/workspace/${PROJECT_PATH} ${WAIT_SEC} ${WAIT_HOST} ${WAIT_PORT}
