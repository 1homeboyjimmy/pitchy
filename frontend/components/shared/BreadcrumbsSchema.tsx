"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function BreadcrumbsSchema() {
    const pathname = usePathname();
    const [schemaHtml, setSchemaHtml] = useState<string>("");

    useEffect(() => {
        if (!pathname || pathname === "/") {
            setSchemaHtml("");
            return;
        }

        const paths = pathname.split("/").filter((p) => p !== "");
        let currentPath = "";

        const itemListElement = [
            {
                "@type": "ListItem",
                position: 1,
                name: "Главная",
                item: "https://pitchy.pro/",
            },
        ];

        paths.forEach((path, index) => {
            currentPath += `/${path}`;
            // Map common paths to readable Russian names
            const nameMap: Record<string, string> = {
                faq: "FAQ",
                pricing: "Тарифы",
                about: "О нас",
                contact: "Контакты",
                terms: "Пользовательское соглашение",
                login: "Войти",
                signup: "Регистрация",
                dashboard: "Панель управления",
            };

            const name = nameMap[path] || path.charAt(0).toUpperCase() + path.slice(1);

            itemListElement.push({
                "@type": "ListItem",
                position: index + 2,
                name: name,
                item: `https://pitchy.pro${currentPath}`,
            });
        });

        const jsonLd = {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement,
        };

        setSchemaHtml(JSON.stringify(jsonLd));
    }, [pathname]);

    if (!schemaHtml) return null;

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: schemaHtml }}
        />
    );
}
