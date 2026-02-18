"use client";

import {
  Badge,
  Button,
  Group,
  List,
  Paper,
  Progress,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useState, useEffect } from "react";
import { AnalyzeResponse, postAuthJson, postJson } from "@/lib/api";
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
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
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
        if (parsed.result) setResult(parsed.result);
      } catch (e) {
        console.error("Failed to parse analysis state", e);
      }
    }
  }, []);

  // Save state to localStorage on changes
  useEffect(() => {
    const state = { values: form.values, result };
    localStorage.setItem("startup_analysis_state", JSON.stringify(state));
  }, [form.values, result]);

  const handleSubmit = form.onSubmit(async (values) => {
    setLoading(true);
    setResult(null);
    try {
      const token = getToken();
      const data = token
        ? await postAuthJson<AnalyzeResponse>("/analysis", values, token)
        : await postJson<AnalyzeResponse>("/analyze-startup", {
          description: [
            `Название: ${values.name}`,
            `Категория: ${values.category || "—"}`,
            `Стадия: ${values.stage || "—"}`,
            values.url ? `Сайт: ${values.url}` : null,
            `Описание: ${values.description}`,
          ]
            .filter(Boolean)
            .join("\n"),
        });
      setResult(data);
      notifications.show({
        title: "Анализ готов",
        message: token
          ? "Результаты сохранены в личном кабинете."
          : "Результаты получены. Войдите, чтобы сохранять историю.",
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: "Ошибка анализа",
        message: error instanceof Error ? error.message : "Request failed",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  });

  return (
    <Stack>
      <div>
        <Title order={3}>Startup Analysis</Title>
        <Text size="sm" c="dimmed" mt={6}>
          Заполните форму и получите структурированную инвестиционную оценку.
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
              Анализировать
            </Button>
            <Text size="xs" c="dimmed">
              Используем контекст из отраслевых документов.
            </Text>
          </Group>
        </Stack>
      </form>

      {result ? (
        <Stack gap="md">
          <Paper withBorder radius="md" p="md">
            <Group justify="space-between" align="center">
              <div>
                <Text size="sm" c="dimmed">
                  Инвестиционная оценка
                </Text>
                <Text size="xl" fw={700}>
                  {result.investment_score}/10
                </Text>
              </div>
              <Badge color={result.investment_score >= 7 ? "green" : "yellow"}>
                {result.investment_score >= 7 ? "High potential" : "Needs work"}
              </Badge>
            </Group>
            <Progress
              mt="sm"
              value={Math.min(100, result.investment_score * 10)}
              color={result.investment_score >= 7 ? "green" : "yellow"}
            />
          </Paper>

          <Group grow align="stretch">
            <Paper withBorder radius="md" p="md">
              <Text fw={600}>Strengths</Text>
              <List mt="xs" spacing="xs">
                {result.strengths.map((item, index) => (
                  <List.Item key={`strength-${index}`}>{item}</List.Item>
                ))}
              </List>
            </Paper>
            <Paper withBorder radius="md" p="md">
              <Text fw={600}>Weaknesses</Text>
              <List mt="xs" spacing="xs">
                {result.weaknesses.map((item, index) => (
                  <List.Item key={`weakness-${index}`}>{item}</List.Item>
                ))}
              </List>
            </Paper>
          </Group>

          <Paper withBorder radius="md" p="md">
            <Text fw={600}>Recommendations</Text>
            <List mt="xs" spacing="xs">
              {result.recommendations.map((item, index) => (
                <List.Item key={`recommendation-${index}`}>{item}</List.Item>
              ))}
            </List>
          </Paper>

          <Paper withBorder radius="md" p="md">
            <Text fw={600}>Market summary</Text>
            <Text mt="xs" c="dimmed">
              {result.market_summary}
            </Text>
          </Paper>
        </Stack>
      ) : null}
    </Stack>
  );
}
