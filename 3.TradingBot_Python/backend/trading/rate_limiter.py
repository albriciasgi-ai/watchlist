"""
Rate Limiter with Token Bucket Algorithm
Provides intelligent rate limiting for Bybit API calls

Bybit Limits (as of 2025):
- Place Order (Linear): 20/second
- Get Position: 50/second
- IP limit: 600 requests per 5 seconds

This implementation uses conservative limits with 50% margin for safety.
"""

import asyncio
import time
from typing import Optional
from dataclasses import dataclass


@dataclass
class RateLimitConfig:
    """Configuration for rate limiter"""
    tokens_per_second: float = 10.0  # Conservative (Bybit allows 20 for orders)
    max_tokens: int = 15  # Burst capacity
    initial_tokens: int = 10
    min_tokens_before_wait: int = 2  # Start waiting when tokens get low
    base_wait_ms: int = 100  # Base wait time in milliseconds
    backoff_multiplier: float = 2.0  # Exponential backoff multiplier
    max_backoff_ms: int = 5000  # Maximum backoff time


class RateLimiter:
    """
    Token Bucket Rate Limiter with adaptive behavior based on Bybit headers.

    Features:
    - Token bucket algorithm with configurable refill rate
    - Adapts to X-Bapi-Limit-Status headers from Bybit
    - Exponential backoff on rate limit errors (10006)
    - Thread-safe with asyncio locks
    """

    def __init__(self, config: Optional[RateLimitConfig] = None):
        self.config = config or RateLimitConfig()
        self._tokens = float(self.config.initial_tokens)
        self._last_refill = time.monotonic()
        self._lock = asyncio.Lock()
        self._consecutive_errors = 0
        self._last_error_time = 0.0

        # Statistics
        self._total_requests = 0
        self._total_waits = 0
        self._total_wait_time_ms = 0.0

    async def acquire(self, tokens: int = 1) -> float:
        """
        Acquire tokens before making an API request.

        Args:
            tokens: Number of tokens to acquire (default 1)

        Returns:
            Wait time in seconds (0 if no wait was needed)
        """
        async with self._lock:
            wait_time = 0.0

            # Refill tokens based on time passed
            self._refill_tokens()

            # Check if we need to wait
            if self._tokens < tokens:
                wait_time = await self._wait_for_tokens(tokens)

            # Check if we should preemptively wait (low tokens)
            elif self._tokens < self.config.min_tokens_before_wait:
                # Small preemptive wait to avoid hitting limits
                preemptive_wait = self.config.base_wait_ms / 1000.0
                await asyncio.sleep(preemptive_wait)
                wait_time = preemptive_wait
                self._refill_tokens()

            # Consume tokens
            self._tokens -= tokens
            self._total_requests += 1

            return wait_time

    def _refill_tokens(self) -> None:
        """Refill tokens based on elapsed time"""
        now = time.monotonic()
        elapsed = now - self._last_refill

        # Calculate tokens to add
        tokens_to_add = elapsed * self.config.tokens_per_second
        self._tokens = min(self._tokens + tokens_to_add, self.config.max_tokens)
        self._last_refill = now

    async def _wait_for_tokens(self, tokens_needed: int) -> float:
        """Wait until enough tokens are available"""
        tokens_deficit = tokens_needed - self._tokens
        wait_time_seconds = tokens_deficit / self.config.tokens_per_second

        # Apply backoff if we've had recent errors
        if self._consecutive_errors > 0:
            backoff = min(
                self.config.base_wait_ms * (self.config.backoff_multiplier ** self._consecutive_errors),
                self.config.max_backoff_ms
            ) / 1000.0
            wait_time_seconds = max(wait_time_seconds, backoff)

        # Ensure minimum wait
        wait_time_seconds = max(wait_time_seconds, self.config.base_wait_ms / 1000.0)

        # Track statistics
        self._total_waits += 1
        self._total_wait_time_ms += wait_time_seconds * 1000

        # Actually wait
        await asyncio.sleep(wait_time_seconds)

        # Refill after waiting
        self._refill_tokens()

        return wait_time_seconds

    def update_from_headers(self, headers: dict) -> None:
        """
        Update rate limiter state based on Bybit response headers.

        Bybit headers:
        - X-Bapi-Limit-Status: remaining requests for this endpoint
        - X-Bapi-Limit: total limit for this endpoint
        - X-Bapi-Limit-Reset-Timestamp: when limit resets (if exceeded)
        """
        try:
            remaining = headers.get('X-Bapi-Limit-Status') or headers.get('x-bapi-limit-status')
            if remaining is not None:
                remaining = int(remaining)

                # If Bybit says we have very few requests left, reduce our tokens
                if remaining < 5:
                    self._tokens = min(self._tokens, remaining / 2)

                # If Bybit says we have plenty, we can be more generous
                elif remaining > 15:
                    self._tokens = min(self._tokens + 2, self.config.max_tokens)

        except (ValueError, TypeError):
            pass  # Ignore parsing errors

    def report_error(self, error_code: int) -> None:
        """
        Report an API error to adjust rate limiting.

        Args:
            error_code: Bybit error code (e.g., 10006 for rate limit)
        """
        if error_code == 10006:  # Too many visits
            self._consecutive_errors += 1
            self._last_error_time = time.monotonic()
            # Drastically reduce tokens on rate limit error
            self._tokens = 0
        else:
            # Reset error counter on successful requests or other errors
            self._reset_errors_if_stale()

    def report_success(self) -> None:
        """Report a successful request to reset error state"""
        self._reset_errors_if_stale()
        if self._consecutive_errors > 0:
            self._consecutive_errors = max(0, self._consecutive_errors - 1)

    def _reset_errors_if_stale(self) -> None:
        """Reset error counter if enough time has passed"""
        if self._consecutive_errors > 0:
            time_since_error = time.monotonic() - self._last_error_time
            # Reset after 30 seconds of no errors
            if time_since_error > 30:
                self._consecutive_errors = 0

    def get_statistics(self) -> dict:
        """Get rate limiter statistics"""
        return {
            "total_requests": self._total_requests,
            "total_waits": self._total_waits,
            "total_wait_time_ms": round(self._total_wait_time_ms, 2),
            "avg_wait_time_ms": round(self._total_wait_time_ms / max(1, self._total_waits), 2),
            "current_tokens": round(self._tokens, 2),
            "consecutive_errors": self._consecutive_errors
        }

    async def wait_for_backoff(self) -> float:
        """
        Wait with exponential backoff after a rate limit error.
        Call this after receiving error 10006.

        Returns:
            Actual wait time in seconds
        """
        backoff_ms = min(
            self.config.base_wait_ms * (self.config.backoff_multiplier ** self._consecutive_errors),
            self.config.max_backoff_ms
        )
        wait_seconds = backoff_ms / 1000.0

        await asyncio.sleep(wait_seconds)
        self._refill_tokens()

        return wait_seconds


# Global rate limiter instance (singleton pattern)
_global_rate_limiter: Optional[RateLimiter] = None


def get_rate_limiter() -> RateLimiter:
    """Get or create the global rate limiter instance"""
    global _global_rate_limiter
    if _global_rate_limiter is None:
        _global_rate_limiter = RateLimiter()
    return _global_rate_limiter


def reset_rate_limiter() -> None:
    """Reset the global rate limiter (useful for testing)"""
    global _global_rate_limiter
    _global_rate_limiter = None
