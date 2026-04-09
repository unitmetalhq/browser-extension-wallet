export type TxType = "native" | "erc20" | "erc721" | "raw";

export interface ActivityRecord {
  id?: number;
  txHash: string;
  from: string;
  to: string;
  chainId: number;
  type: TxType;
  nativeValue?: string;
  tokenValue?: string;
  nftId?: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  gasPrice?: string;
  ensName?: string;
  timestamp: number;
}
