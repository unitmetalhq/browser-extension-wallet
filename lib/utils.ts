import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function truncateAddress(address: string | undefined) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function truncateHash(hash: string | undefined) {
  if (!hash) return "";
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

export function serializeTransactionObject(transactionObject: object): string {
  return JSON.stringify(
    transactionObject,
    (_key, value) => (typeof value === "bigint" ? `0x${value.toString(16)}` : value),
    2
  );
}
