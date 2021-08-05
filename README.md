# loanscan-api

This code updates an s3 bucket with the latest APR data so loanscan can query it

## Setup

1) Clone this repo

2) Get AWS credentials file from LastPass and make sure it is in ~/.aws/credentials

3) `npm install ci`

> Note: Has to be identical to the package-lock.json file from the sdk

## Run

```
npx hardhat run src/index.ts --network mainnet
```

