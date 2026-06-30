import { StrKey } from "@stellar/stellar-sdk";

/** Returns true when `contractId` is a valid Soroban contract address (C...). */
export function isValidStellarContractId(contractId: string): boolean {
  return typeof contractId === "string" && StrKey.isValidContract(contractId);
}

/** Returns true when `address` is any valid Stellar address (account G... or contract C...). */
export function isValidStellarAddress(address: string): boolean {
  return (
    typeof address === "string" &&
    (StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address))
  );
}
