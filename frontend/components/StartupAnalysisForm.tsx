"use client";

import {
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/auth";

type FormValues = {
  name: string;
  description: string;
  category: string;
  url: string;
  stage: string;
};

const stages = [
  { value: "idea", label: "Idea" },
  { value: "mvp", label: "MVP" },
  { value: "seed", label: "Seed" },
  { value: "series-a", label: "Series A" },
  { value: "growth", label: "Growth" },
];

const categories = [
  "B2B SaaS",
  "Fintech",
  "EdTech",
  "E-commerce",
  "HealthTech",
  "AI/ML",
];

export function StartupAnalysisForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const form = useForm<FormValues>({
    initialValues: {
      name: "",
      description: "",
      category: "",
      url: "",
      stage: "",
    },
    validate: {
      name: (value) => (value.trim().length < 2 ? "Enter a name" : null),
      description: (value) =>
        value.trim().length < 10 ? "Enter at least 10 characters" : null,
    },
  });

  // Load state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("startup_analysis_state");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.values) form.setValues(parsed.values);
      } catch (e) {
        console.error("Failed to parse analysis state", e);
      }
    }
  }, [form]);

  // Save state to localStorage on changes
  useEffect(() => {
    localStorage.setItem("startup_analysis_state", JSON.stringify({ values: form.values }));
  }, [form.values]);

  const handleSubmit = form.onSubmit(async (values) => {
    setLoading(true);
    try {
      const token = getToken();

      const descriptionArr = [
        `Название: ${values.name}`,
        `Категория: ${values.category || "—"}`,
        `Стадия: ${values.stage || "—"}`,
        values.url ? `Сайт: ${values.url}` : null,
        `Описание: ${values.description}`
      ].filter(Boolean);

      const initialMessage = "Проанализируй мой стартап:\n\n" + descriptionArr.join("\n");
      const encodedMsg = encodeURIComponent(initialMessage);

      const dashboardUrl = `/dashboard?tab=chat&new_chat=true&initial_message=${encodedMsg}`;

      if (token) {
        router.push(dashboardUrl);
      } else {
        router.push(`/signup?next=${encodeURIComponent(dashboardUrl)}`);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  });

  return (
    <Stack>
      <div>
        <Title order={3}>Startup Analysis</Title>
        <Text size="sm" c="dimmed" mt={6}>
          Заполните форму, чтобы начать интерактивный анализ с AI-инвестором.
        </Text>
      </div>

      <form onSubmit={handleSubmit}>
        <Stack>
          <Group grow>
            <TextInput
              label="Название"
              placeholder="Venture AI"
              {...form.getInputProps("name")}
            />
            <Select
              label="Категория"
              placeholder="Выберите категорию"
              data={categories}
              {...form.getInputProps("category")}
            />
          </Group>
          <Group grow>
            <Select
              label="Стадия"
              placeholder="Например, Seed"
              data={stages}
              {...form.getInputProps("stage")}
            />
            <TextInput
              label="URL"
              placeholder="https://startup.ru"
              {...form.getInputProps("url")}
            />
          </Group>
          <Textarea
            label="Описание"
            minRows={4}
            placeholder="Рынок, продукт, команда, выручка, traction"
            {...form.getInputProps("description")}
          />
          <Group justify="space-between">
            <Button type="submit" loading={loading}>
              Начать анализ
            </Button>
            <Text size="xs" c="dimmed">
              Вас перенаправит в чат с AI.
            </Text>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
