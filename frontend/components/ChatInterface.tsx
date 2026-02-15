"use client";

import {
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useRef, useState } from "react";
import { ChatMessage, postJson } from "@/lib/api";

export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages, loading]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setInput("");
    setLoading(true);
    setMessages(next);
    try {
      const data = await postJson<{ reply: string }>("/chat", {
        messages: next,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (error) {
      notifications.show({
        title: "Ошибка чата",
        message: error instanceof Error ? error.message : "Request failed",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack>
      <div>
        <Title order={3}>Chat</Title>
        <Text size="sm" c="dimmed" mt={6}>
          Задайте уточняющие вопросы и обсудите гипотезы с ассистентом.
        </Text>
      </div>

      <ScrollArea h={380} viewportRef={viewportRef}>
        <Stack gap="sm">
          {messages.length === 0 ? (
            <Text size="sm" c="dimmed">
              Нет сообщений. Начните диалог.
            </Text>
          ) : null}
          {messages.map((message, index) => (
            <Paper
              key={`${message.role}-${index}`}
              radius="md"
              p="sm"
              withBorder
              style={{
                alignSelf: message.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
              }}
              bg={
                message.role === "user"
                  ? isDark
                    ? "blue.9"
                    : "blue.0"
                  : isDark
                    ? "dark.6"
                    : "gray.0"
              }
            >
              <Text size="sm">{message.content}</Text>
            </Paper>
          ))}
          {loading ? (
            <Paper
              radius="md"
              p="sm"
              withBorder
              bg={isDark ? "dark.6" : "gray.0"}
              style={{ maxWidth: "70%" }}
            >
              <Text size="sm" c="dimmed">
                Ассистент печатает...
              </Text>
            </Paper>
          ) : null}
        </Stack>
      </ScrollArea>

      <Group align="flex-end">
        <TextInput
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          placeholder="Напишите сообщение..."
          style={{ flex: 1 }}
        />
        <Button onClick={sendMessage} loading={loading}>
          Отправить
        </Button>
      </Group>
    </Stack>
  );
}
