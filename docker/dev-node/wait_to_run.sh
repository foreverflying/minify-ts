#!/bin/sh

project_path=$1

exit_with_usage() {
    echo "Usage:"
    echo "sh wait_to_run.sh <project_abs_path> [wait_sec] [wait_host <wait_port>]"
    echo "accept environment:"
    echo "RUN_CMD: the command to run, if not assigned, 'tail -f /dev/null' by default"
    echo "INIT_FILE: a .sh file in project_path, will execute it before run the RUN_CMD"
    exit
}

if [ ! -d "$project_path" ]; then
    echo "Error: Path $project_path is not a directory!"
    exit_with_usage
fi

project_path=$(cd $project_path && pwd)
owner=$(stat -c '%U' $project_path)

if [ "$(whoami)" = "root" ]; then
    owner_group=$(stat -c '%G' $project_path)
    if [ "$owner" != "user" ]; then
        if [ "$owner" != "UNKNOWN" ]; then
            userdel $owner
        fi
        if [ "$owner_group" != "UNKNOWN" ] && [ "$owner" != "$owner_group" ]; then
            groupdel $owner_group
        fi
        owner_uid=$(stat -c '%u' $project_path)
        owner_gid=$(stat -c '%g' $project_path)
        userdel user
        groupadd -g $owner_gid user
        useradd user -u $owner_uid -g $owner_gid -s /bin/bash
        if [ "$(stat -c '%U' /opt/workspace)" != "user" ]; then
            chown $owner_uid:$owner_gid /opt/workspace
        fi
        if [ "$(stat -c '%U' /home/user)" != "user" ]; then
            chown $owner_uid:$owner_gid /home/user
        fi
    fi
    su user -c "sh $0 $project_path $2 $3 $4"
    exit
fi

if [ "$owner" = "root" ]; then
    # might be on mac, the initial owner is always root, but will change after being touched
    touch $project_path
    if [ $? -ne 0 ]; then
        echo "the owner of $project_path is root, please use a normal user instead"
        exit
    fi
elif [ "$owner" != "user" ]; then
    sudo -E su -c "sh $0 $project_path $2 $3 $4"
    exit
fi

wait_sec=$2
wait_host=$3
wait_port=$4
run_cmd=${RUN_CMD}
init_file=${INIT_FILE}


if [ -n "$wait_host" ]; then
    if [ -z "$wait_port" ]; then
        exit_with_usage
    fi
    nc_check=1
    until [ $nc_check -eq 0 ]; do
        nc -z $wait_host $wait_port
        nc_check=$?
        sleep 1
    done
fi

if [ -n "$wait_sec" ]; then
    echo "wait for $wait_sec seconds to start ..."
    sleep $wait_sec
fi

if [ -n "$init_file" ]; then
    if [ -f "$project_path/$init_file" ]; then
        echo "run $project_path/$init_file ..."
        cd $project_path && sh "./$init_file"
    else
        echo "$project_path/$init_file does not exist"
    fi
fi

if [ -n "$run_cmd" ]; then
    cd $project_path && sh -c "$run_cmd"
else
    tail -f /dev/null
fi