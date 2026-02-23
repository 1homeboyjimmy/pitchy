"use client";

import { Card, Code, Loader, Stack, Table, Text, Title } from "@mantine/core";
import { useEffect, useState } from "react";

type DevEmail = {
  to: string;
  subject: string;
  body: string;
  created_at: string;
};

export default function DevTokensPage() {
  const [emails, setEmails] = useState<DevEmail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/dev/emails`)
      .then((res) => res.json())
      .then((data) => setEmails(data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card withBorder radius="lg" m="lg">
      <Stack>
        <Title order={3}>Dev Emails (tokens)</Title>
        <Text size="sm" c="dimmed">
          Доступно только при APP_ENV=dev.
        </Text>
        {loading ? (
          <Loader />
        ) : emails.length === 0 ? (
          <Text size="sm">Нет писем.</Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Дата</Table.Th>
                <Table.Th>Кому</Table.Th>
                <Table.Th>Тема</Table.Th>
                <Table.Th>Тело</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {emails.map((email, idx) => (
                <Table.Tr key={`${email.to}-${idx}`}>
                  <Table.Td>{email.created_at}</Table.Td>
                  <Table.Td>{email.to}</Table.Td>
                  <Table.Td>{email.subject}</Table.Td>
                  <Table.Td>
                    <Code block>{email.body}</Code>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
  );
}
