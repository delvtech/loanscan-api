#! /bin/bash

cd loanscan-api
source elf.env
source /home/ec2-user/.bashrc
npx hardhat run src/index.ts --network mainnet
