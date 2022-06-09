#!/bin/sh

# self_dir="$( cd "$( dirname "$0" )" >/dev/null 2>&1 && pwd )"

if [ ! $(npm -g get prefix | grep .npm) ]; then
    sudo npm -g config set prefix ~/.npm
fi

if [ ! -f ~/.initiated ]; then
    npm -g i typescript ts-node jest
    npm -g update
    touch ~/.initiated
fi

if [ ! -f .initiated ]; then
    npm i && touch .initiated
fi
