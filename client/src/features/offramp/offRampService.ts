/**
 * Fiat Off-Ramp Service
 * Handles integration with MoonPay or Stellar Anchor for bank withdrawals
 */

import type { OffRampTransaction, WithdrawalRequest, OffRampProvider, OffRampError, OffRampErrorType } from "./types";

const STORAGE_KEY = "stellar_yield_offramp_txns";

/**
 * Create a structured off-ramp error
 */
function createOffRampError(
    type: OffRampErrorType,
    userMessage: string,
    retryable: boolean,
    originalError?: Error,
    transactionId?: string,
): OffRampError {
    const error = new Error(userMessage) as OffRampError;
    error.type = type;
    error.userMessage = userMessage;
    error.retryable = retryable;
    error.transactionId = transactionId;
    if (originalError) {
        error.cause = originalError;
    }
    return error;
}

export class OffRampService {
    private provider: OffRampProvider;
    private apiKey: string;
    private baseUrl: string;

    constructor(provider: OffRampProvider, apiKey: string, baseUrl: string) {
        this.provider = provider;
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }

    /**
     * Initiate a fiat off-ramp transaction
     * Constructs withdrawal: vault shares → USDC → fiat wire
     */
    async initiateWithdrawal(request: WithdrawalRequest): Promise<OffRampTransaction> {
        const txId = `offramp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

        const transaction: OffRampTransaction = {
            id: txId,
            status: "pending",
            amount: request.usdcAmount.toString(),
            currency: "USDC",
            bankAccount: request.bankAccount,
            memo: this.generateMemo(request),
            createdAt: Date.now(),
        };

        // Validate destination address and memo
        try {
            this.validateDestination(request.bankAccount, transaction.memo);
        } catch (error) {
            if (error instanceof Error && error.message.includes("bank account")) {
                throw createOffRampError(
                    "INVALID_BANK_ACCOUNT",
                    "Bank account number is invalid. Please check the format and try again.",
                    false,
                    error,
                    txId,
                );
            } else if (error instanceof Error && error.message.includes("memo")) {
                throw createOffRampError(
                    "INVALID_MEMO",
                    "Account holder name contains invalid characters. Please use only letters and numbers.",
                    false,
                    error,
                    txId,
                );
            }
            throw error;
        }

        // Store transaction locally
        this.saveTransaction(transaction);

        // Call off-ramp provider API
        try {
            await this.submitToProvider(transaction, request);
        } catch (error) {
            transaction.status = "failed";
            if (error instanceof OffRampError) {
                transaction.errorMessage = error.userMessage;
            } else {
                transaction.errorMessage = error instanceof Error ? error.message : "Unknown error";
            }
            this.saveTransaction(transaction);
            throw error;
        }

        return transaction;
    }

    /**
     * Poll off-ramp provider for transaction status
     */
    async pollStatus(txId: string): Promise<OffRampTransaction | null> {
        const tx = this.loadTransaction(txId);
        if (!tx) return null;

        try {
            const response = await fetch(`${this.baseUrl}/transactions/${txId}`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw createOffRampError(
                        "AUTHENTICATION_FAILURE",
                        "Authentication failed. Please contact support.",
                        false,
                        undefined,
                        txId,
                    );
                } else if (response.status === 503) {
                    throw createOffRampError(
                        "PROVIDER_DOWNTIME",
                        "Provider is temporarily unavailable. Please try again later.",
                        true,
                        undefined,
                        txId,
                    );
                }
                throw new Error(`Status code: ${response.status}`);
            }

            const data = (await response.json()) as { status: string; error?: string };
            const status = this.mapProviderStatus(data.status);

            tx.status = status;
            if (status === "completed") {
                tx.completedAt = Date.now();
            } else if (status === "failed") {
                tx.errorMessage = data.error || "Transaction failed";
            }

            this.saveTransaction(tx);
            return tx;
        } catch (error) {
            if (error instanceof OffRampError) {
                throw error;
            }
            tx.status = "failed";
            tx.errorMessage = error instanceof Error ? error.message : "Poll failed";
            this.saveTransaction(tx);
            throw createOffRampError(
                "NETWORK_ERROR",
                "Unable to check transaction status. Please try again later.",
                true,
                error instanceof Error ? error : undefined,
                txId,
            );
        }
    }

    /**
     * Get all transactions for current user
     */
    getAllTransactions(): OffRampTransaction[] {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? (JSON.parse(stored) as OffRampTransaction[]) : [];
        } catch {
            return [];
        }
    }

    /**
     * Generate memo for off-ramp deposit address
     * Format: "SY:{accountHolder}:{timestamp}" (max 28 chars for Stellar)
     */
    private generateMemo(request: WithdrawalRequest): string {
        const sanitized = request.accountHolder.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
        const ts = Date.now().toString().slice(-6);
        return `SY:${sanitized}:${ts}`.slice(0, 28);
    }

    /**
     * Validate destination address and memo to prevent fund loss
     */
    private validateDestination(bankAccount: string, memo: string): void {
        if (!bankAccount || bankAccount.length < 8) {
            throw new Error("Invalid bank account number");
        }
        if (!memo || memo.length === 0 || memo.length > 28) {
            throw new Error("Invalid memo format");
        }
    }

    /**
     * Submit withdrawal to off-ramp provider
     */
    private async submitToProvider(
        transaction: OffRampTransaction,
        request: WithdrawalRequest,
    ): Promise<void> {
        const payload = {
            amount: transaction.amount,
            currency: transaction.currency,
            bankAccount: transaction.bankAccount,
            memo: transaction.memo,
            accountHolder: request.accountHolder,
            bankName: request.bankName,
        };

        try {
            const response = await fetch(`${this.baseUrl}/withdrawals`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
                const errorMessage = (errorData.message as string) || response.statusText;

                if (response.status === 400) {
                    if (errorMessage.includes("region")) {
                        throw createOffRampError(
                            "UNSUPPORTED_REGION",
                            "Your region is not supported for this transaction. Please check supported countries.",
                            false,
                            undefined,
                            transaction.id,
                        );
                    } else if (errorMessage.includes("liquidity")) {
                        throw createOffRampError(
                            "INSUFFICIENT_LIQUIDITY",
                            "Insufficient liquidity for this amount. Please try a smaller amount or try again later.",
                            true,
                            undefined,
                            transaction.id,
                        );
                    } else if (errorMessage.includes("exists")) {
                        throw createOffRampError(
                            "TRANSACTION_EXISTS",
                            "A transaction with this account already exists. Please wait for it to complete.",
                            false,
                            undefined,
                            transaction.id,
                        );
                    }
                } else if (response.status === 401 || response.status === 403) {
                    throw createOffRampError(
                        "AUTHENTICATION_FAILURE",
                        "Authentication failed. Please contact support.",
                        false,
                        undefined,
                        transaction.id,
                    );
                } else if (response.status === 503) {
                    throw createOffRampError(
                        "PROVIDER_DOWNTIME",
                        "Provider is temporarily unavailable. Please try again later.",
                        true,
                        undefined,
                        transaction.id,
                    );
                }

                throw createOffRampError(
                    "UNKNOWN_ERROR",
                    `Provider error: ${errorMessage}`,
                    true,
                    undefined,
                    transaction.id,
                );
            }
        } catch (error) {
            if (error instanceof OffRampError) {
                throw error;
            }
            throw createOffRampError(
                "NETWORK_ERROR",
                "Network error. Please check your connection and try again.",
                true,
                error instanceof Error ? error : undefined,
                transaction.id,
            );
        }
    }

    /**
     * Map provider status to internal status
     */
    private mapProviderStatus(providerStatus: string): "pending" | "completed" | "failed" {
        const statusMap: Record<string, "pending" | "completed" | "failed"> = {
            pending: "pending",
            processing: "pending",
            completed: "completed",
            success: "completed",
            failed: "failed",
            error: "failed",
        };
        return statusMap[providerStatus.toLowerCase()] || "pending";
    }

    private saveTransaction(tx: OffRampTransaction): void {
        const all = this.getAllTransactions();
        const idx = all.findIndex((t) => t.id === tx.id);
        if (idx >= 0) {
            all[idx] = tx;
        } else {
            all.push(tx);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }

    private loadTransaction(txId: string): OffRampTransaction | null {
        const all = this.getAllTransactions();
        return all.find((t) => t.id === txId) || null;
    }
}
