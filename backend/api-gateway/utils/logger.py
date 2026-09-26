import logging
import sys

# Shared language-code mapping used throughout the codebase.
# Single source of truth — import this instead of redefining it in each module.
LANGUAGE_MAP: dict = {"english": "en", "urdu": "ur"}


def get_logger(name: str) -> logging.Logger:
    """
    Returns a standardized logger for the Unified Assistant.
    All modules should call get_logger() instead of logging.getLogger()
    directly so that the handler/formatter configuration is applied uniformly.
    """
    logger = logging.getLogger(name)

    # Only configure if it doesn't already have handlers to prevent duplicate logs
    if not logger.handlers:
        logger.setLevel(logging.INFO)

        # Create console handler with standard output
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(logging.INFO)

        # Standardized formatting
        formatter = logging.Formatter(
            fmt="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)

        # Prevent propagation to root logger
        logger.propagate = False

    return logger
