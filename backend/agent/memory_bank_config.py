import os

from vertexai import types as vertexai_types

ManagedTopicEnum = vertexai_types.ManagedTopicEnum
MemoryTopic = vertexai_types.MemoryBankCustomizationConfigMemoryTopic
CustomMemoryTopic = vertexai_types.MemoryBankCustomizationConfigMemoryTopicCustomMemoryTopic
ManagedMemoryTopic = vertexai_types.MemoryBankCustomizationConfigMemoryTopicManagedMemoryTopic


def build_memory_bank_config(project_id: str, location: str) -> dict:
    generation_model = os.getenv(
        "MEMORY_BANK_GENERATION_MODEL",
        f"projects/{project_id}/locations/{location}/publishers/google/models/gemini-2.5-flash",
    )
    embedding_model = os.getenv(
        "MEMORY_BANK_EMBEDDING_MODEL",
        f"projects/{project_id}/locations/{location}/publishers/google/models/gemini-embedding-001",
    )

    memory_topics = [
        MemoryTopic(
            managed_memory_topic=ManagedMemoryTopic(
                managed_topic_enum=ManagedTopicEnum.USER_PREFERENCES
            )
        ),
        MemoryTopic(
            managed_memory_topic=ManagedMemoryTopic(
                managed_topic_enum=ManagedTopicEnum.USER_PERSONAL_INFO
            )
        ),
        MemoryTopic(
            custom_memory_topic=CustomMemoryTopic(
                label="style_identity",
                description=(
                    "Core style identity and recurring fashion choices including favorite "
                    "colors, silhouettes, dress codes, and how the user wants to come across "
                    "in important moments."
                ),
            )
        ),
        MemoryTopic(
            custom_memory_topic=CustomMemoryTopic(
                label="signature_items",
                description=(
                    "Signature accessories or style markers the user calls out repeatedly, "
                    "such as hats, jackets, shoes, jewelry, or any visual item they identify "
                    "as part of their personal style."
                ),
            )
        ),
        MemoryTopic(
            custom_memory_topic=CustomMemoryTopic(
                label="comfort_constraints",
                description=(
                    "Durable comfort and fit preferences such as fabric dislikes, layering "
                    "needs, temperature sensitivity, mobility concerns, and other practical "
                    "constraints that influence outfit advice."
                ),
            )
        ),
        MemoryTopic(
            custom_memory_topic=CustomMemoryTopic(
                label="event_context",
                description=(
                    "Recurring event and environment context that shapes styling advice, "
                    "including conferences, dinners, travel, social settings, and the tone "
                    "the user wants to project."
                ),
            )
        ),
        MemoryTopic(
            custom_memory_topic=CustomMemoryTopic(
                label="visual_style_markers",
                description=(
                    "Semantically meaningful visual details inferred from images or camera "
                    "snapshots when they are supported by the user's spoken description, "
                    "such as a signature black hat, preferred layering, or styling details."
                ),
            )
        ),
    ]

    return {
        "customization_configs": [
            {
                "memory_topics": memory_topics,
            }
        ],
        "similarity_search_config": {
            "embedding_model": embedding_model,
        },
        "generation_config": {
            "model": generation_model,
        },
    }
